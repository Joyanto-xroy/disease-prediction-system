/**
 * Supabase Authentication and Authorization Module
 * 
 * This module handles user authentication, registration, and profile management
 * with proper separation of concerns, error handling, and security practices.
 * 
 * Supabase v2 Workflow:
 * 1. Auth Phase: User creates account with email/password via supabase.auth.signUp()
 * 2. Profile Phase: Database trigger automatically creates profile record
 * 3. Storage Phase: License file uploaded to 'licenses' bucket
 * 4. Update Phase: Profile updated with license_url and metadata
 */

import { supabase } from './supabase-config.js';

// ============================================================================
// CONSTANTS AND CONFIGURATION
// ============================================================================

const AUTH_CONFIG = {
    MIN_PASSWORD_LENGTH: 6,
    MAX_PASSWORD_LENGTH: 128,
    FILE_MAX_SIZE: 5 * 1024 * 1024, // 5MB
    ALLOWED_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
    REDIRECT_DELAY: 1500, // ms
};

const ERROR_MESSAGES = {
    // Auth errors
    INVALID_EMAIL: 'Please enter a valid email address',
    INVALID_PASSWORD_LENGTH: `Password must be between ${AUTH_CONFIG.MIN_PASSWORD_LENGTH} and ${AUTH_CONFIG.MAX_PASSWORD_LENGTH} characters`,
    PASSWORDS_MISMATCH: 'Passwords do not match',
    EMAIL_IN_USE: 'This email is already registered',
    INVALID_CREDENTIALS: 'Invalid email or password',
    
    // Validation errors
    MISSING_FULL_NAME: 'Please enter your full name',
    MISSING_ROLE: 'Please select a role (Doctor or Admin)',
    MISSING_DOCTOR_ID: 'Please enter your doctor ID',
    MISSING_CLINIC_PERMIT: 'Please enter your clinic permit ID',
    MISSING_LICENSE: 'Please upload your license document',
    
    // File errors
    INVALID_FILE_TYPE: 'License must be an image (JPEG, PNG, or WebP)',
    FILE_TOO_LARGE: `File size must be less than ${AUTH_CONFIG.FILE_MAX_SIZE / (1024 * 1024)}MB`,
    FILE_UPLOAD_FAILED: 'Failed to upload license file',
    
    // Database errors
    PROFILE_CREATION_FAILED: 'Failed to create user profile',
    PROFILE_UPDATE_FAILED: 'Failed to update user profile with license',
    
    // Verification errors
    ACCOUNT_PENDING_VERIFICATION: 'Your account is pending verification by an administrator. Please check back later.',
    ACCOUNT_REJECTED: 'Your account registration has been rejected. Please contact support.',
    
    // Generic errors
    LOGIN_FAILED: 'Login failed. Please try again.',
    REGISTRATION_FAILED: 'Registration failed. Please try again.',
    NETWORK_ERROR: 'Network error. Please check your connection and try again.',
    UNKNOWN_ERROR: 'An unexpected error occurred. Please try again.',
};

// ============================================================================
// UI STATE MANAGEMENT
// ============================================================================

/**
 * Shows error message in UI with styling
 * @param {string} message - Error message to display
 */
function showError(message = '') {
    const errorDiv = document.getElementById('errorMessage');
    const successDiv = document.getElementById('successMessage');

    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.classList.add('show');
        errorDiv.setAttribute('role', 'alert'); // Accessibility
    }
    if (successDiv) {
        successDiv.classList.remove('show');
    }
}

/**
 * Shows success message in UI with styling
 * @param {string} message - Success message to display
 */
function showSuccess(message = '') {
    const errorDiv = document.getElementById('errorMessage');
    const successDiv = document.getElementById('successMessage');

    if (successDiv) {
        successDiv.textContent = message;
        successDiv.classList.add('show');
        successDiv.setAttribute('role', 'status'); // Accessibility
    }
    if (errorDiv) {
        errorDiv.classList.remove('show');
    }
}

/**
 * Clears all messages from UI
 */
function hideMessages() {
    const errorDiv = document.getElementById('errorMessage');
    const successDiv = document.getElementById('successMessage');

    if (errorDiv) errorDiv.classList.remove('show');
    if (successDiv) successDiv.classList.remove('show');
}

/**
 * Sets loading state on a button element
 * @param {HTMLElement} button - Button element
 * @param {boolean} isLoading - Loading state
 * @param {string} loadingText - Text to show while loading
 * @param {string} originalText - Original button text
 */
function setButtonLoading(button, isLoading, loadingText, originalText = 'Submit') {
    button.disabled = isLoading;
    button.setAttribute('aria-busy', isLoading);
    button.textContent = isLoading ? loadingText : originalText;
}

// ============================================================================
// INPUT VALIDATION
// ============================================================================

/**
 * Validates email format
 * @param {string} email - Email to validate
 * @returns {boolean} - True if valid
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Validates password requirements
 * @param {string} password - Password to validate
 * @returns {object} - { valid: boolean, error?: string }
 */
function validatePassword(password) {
    if (!password || password.length < AUTH_CONFIG.MIN_PASSWORD_LENGTH) {
        return {
            valid: false,
            error: ERROR_MESSAGES.INVALID_PASSWORD_LENGTH
        };
    }
    if (password.length > AUTH_CONFIG.MAX_PASSWORD_LENGTH) {
        return {
            valid: false,
            error: ERROR_MESSAGES.INVALID_PASSWORD_LENGTH
        };
    }
    return { valid: true };
}

/**
 * Validates file selection and constraints
 * @param {File} file - File to validate
 * @returns {object} - { valid: boolean, error?: string }
 */
function validateFile(file) {
    if (!file) {
        return {
            valid: false,
            error: ERROR_MESSAGES.MISSING_LICENSE
        };
    }

    if (!AUTH_CONFIG.ALLOWED_MIME_TYPES.includes(file.type)) {
        return {
            valid: false,
            error: ERROR_MESSAGES.INVALID_FILE_TYPE
        };
    }

    if (file.size > AUTH_CONFIG.FILE_MAX_SIZE) {
        return {
            valid: false,
            error: ERROR_MESSAGES.FILE_TOO_LARGE
        };
    }

    return { valid: true };
}

/**
 * Validates registration form input data
 * @param {object} formData - Form data to validate
 * @returns {object} - { valid: boolean, error?: string }
 */
function validateRegistrationForm(formData) {
    const {
        fullName,
        email,
        role,
        password,
        confirmPassword,
        doctorId,
        clinicPermitId,
        licenseFile
    } = formData;

    // Basic validation
    if (!fullName || fullName.trim().length === 0) {
        return { valid: false, error: ERROR_MESSAGES.MISSING_FULL_NAME };
    }

    if (!email || !isValidEmail(email)) {
        return { valid: false, error: ERROR_MESSAGES.INVALID_EMAIL };
    }

    if (!role) {
        return { valid: false, error: ERROR_MESSAGES.MISSING_ROLE };
    }

    if (password !== confirmPassword) {
        return { valid: false, error: ERROR_MESSAGES.PASSWORDS_MISMATCH };
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
        return passwordValidation;
    }

    // Role-specific validation
    if (role === 'doctor') {
        if (!doctorId || doctorId.trim().length === 0) {
            return { valid: false, error: ERROR_MESSAGES.MISSING_DOCTOR_ID };
        }
        const fileValidation = validateFile(licenseFile);
        if (!fileValidation.valid) {
            return fileValidation;
        }
    } else if (role === 'admin') {
        if (!clinicPermitId || clinicPermitId.trim().length === 0) {
            return { valid: false, error: ERROR_MESSAGES.MISSING_CLINIC_PERMIT };
        }
        const fileValidation = validateFile(licenseFile);
        if (!fileValidation.valid) {
            return fileValidation;
        }
    }

    return { valid: true };
}

// ============================================================================
// STORAGE MANAGEMENT - File Upload to Supabase Storage
// ============================================================================

/**
 * Uploads license file to Supabase storage 'licenses' bucket
 * 
 * Supabase Storage Flow:
 * 1. File uploaded to bucket: licenses/{userId}/{role}_license.{ext}
 * 2. File stored with retention policy
 * 3. Public URL generated for access
 * 
 * @param {string} userId - Supabase user ID
 * @param {string} role - User role (doctor or admin)
 * @param {File} file - File to upload
 * @returns {Promise<string>} - Public URL of uploaded file
 * @throws {Error} - Upload or network error
 */
async function uploadLicenseFile(userId, role, file) {
    try {
        // Validate file before upload
        const fileValidation = validateFile(file);
        if (!fileValidation.valid) {
            throw new Error(fileValidation.error);
        }

        // Generate unique file path
        // Using userId to organize files and ensure uniqueness
        const fileExtension = file.name.split('.').pop().toLowerCase();
        const fileName = `${role}_license_${Date.now()}.${fileExtension}`;
        const filePath = `${userId}/${fileName}`;

        console.log(`[Storage] Uploading license to: licenses/${filePath}`);

        // Upload file using Supabase storage client
        // Supabase v2: storage.from(bucket).upload(path, file, options)
        const { data, error } = await supabase.storage
            .from('licenses')
            .upload(filePath, file, {
                cacheControl: '3600', // Cache for 1 hour
                upsert: false, // Fail if file exists (no overwrite)
            });

        if (error) {
            console.error('[Storage Error]', error);
            throw new Error(ERROR_MESSAGES.FILE_UPLOAD_FAILED);
        }

        console.log('[Storage] Upload successful:', data);

        // Get public URL for the uploaded file
        // This URL is used to display the license in the system
        const { data: urlData, error: urlError } = supabase.storage
            .from('licenses')
            .getPublicUrl(filePath);

        if (urlError) {
            console.error('[Storage URL Error]', urlError);
            throw new Error('Failed to generate file URL');
        }

        const publicUrl = urlData.publicUrl;
        console.log('[Storage] Public URL generated:', publicUrl);

        return publicUrl;

    } catch (error) {
        console.error('[Upload Error]', error);
        throw error;
    }
}

// ============================================================================
// AUTHENTICATION - Supabase Auth Service
// ============================================================================

/**
 * Creates new user account using Supabase Authentication
 * 
 * Supabase Auth Flow (v2):
 * 1. POST /auth/v1/signup called via supabase.auth.signUp()
 * 2. User record created in auth.users table
 * 3. User UUID generated automatically
 * 4. Database trigger fires: on_auth_user_created
 * 5. Trigger calls handle_new_user() function
 * 6. Profile record created automatically in profiles table
 * 
 * @param {string} email - User email
 * @param {string} password - User password
 * @param {string} fullName - User full name
 * @param {string} role - User role (doctor or admin)
 * @param {object} metadata - Additional user metadata
 * @returns {Promise<object>} - { user, session }
 * @throws {Error} - Auth error (email in use, invalid credentials, etc.)
 */
async function createUserAccount(email, password, fullName, role, metadata = {}) {
    try {
        console.log(`[Auth] Creating account for ${email} as ${role}`);

        const { data, error } = await supabase.auth.signUp({
            email: email,
            password: password,
            options: {
                // User metadata stored in auth.users.raw_user_meta_data
                // Used by trigger to populate profile fields
                data: {
                    full_name: fullName,
                    role: role,
                    ...metadata, // Include role-specific fields
                }
            }
        });

        if (error) {
            console.error('[Auth Error]', error.message);
            
            // Handle specific Supabase auth errors
            if (error.message.includes('already registered')) {
                throw new Error(ERROR_MESSAGES.EMAIL_IN_USE);
            }
            if (error.message.includes('invalid')) {
                throw new Error(ERROR_MESSAGES.INVALID_CREDENTIALS);
            }
            
            throw new Error(error.message || ERROR_MESSAGES.REGISTRATION_FAILED);
        }

        console.log('[Auth] Account created successfully:', data.user?.id);
        return data;

    } catch (error) {
        console.error('[Account Creation Error]', error);
        throw error;
    }
}

/**
 * Updates user profile in database with license information
 * 
 * RLS Security:
 * - User can only update their own profile (auth.uid() = id)
 * - Admin can update other user profiles (role = 'admin')
 * 
 * @param {string} userId - Supabase user ID
 * @param {string} licenseUrl - Public URL of uploaded license
 * @param {object} additionalData - Additional profile data to update
 * @returns {Promise<object>} - Updated profile record
 * @throws {Error} - Database or RLS error
 */
async function updateProfileWithLicense(userId, licenseUrl, additionalData = {}) {
    try {
        console.log('[Profile] Updating profile with license URL');

        const updateData = {
            license_url: licenseUrl,
            verification_status: 'pending', // Set to pending for doctor verification
            updated_at: new Date().toISOString(),
            ...additionalData
        };

        // Update profiles table via authenticated request
        // RLS policies enforce user can only update own profile
        const { data, error } = await supabase
            .from('profiles')
            .update(updateData)
            .eq('id', userId)
            .select()
            .single();

        if (error) {
            console.error('[Profile Update Error]', error);
            throw new Error(ERROR_MESSAGES.PROFILE_UPDATE_FAILED);
        }

        console.log('[Profile] Updated successfully:', data);
        return data;

    } catch (error) {
        console.error('[Profile Update Error]', error);
        throw error;
    }
}

/**
 * Signs in user with email and password
 * 
 * Login Flow:
 * 1. POST /auth/v1/token called via supabase.auth.signInWithPassword()
 * 2. Credentials verified against auth.users
 * 3. JWT tokens returned (access + refresh)
 * 4. Tokens stored in localStorage/sessionStorage
 * 5. User session established
 * 
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<object>} - { user, session }
 * @throws {Error} - Auth error
 */
async function signInUser(email, password) {
    try {
        console.log(`[Auth] Signing in user: ${email}`);

        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password,
        });

        if (error) {
            console.error('[Sign In Error]', error.message);
            throw new Error(ERROR_MESSAGES.INVALID_CREDENTIALS);
        }

        console.log('[Auth] Sign in successful');
        return data;

    } catch (error) {
        console.error('[Sign In Error]', error);
        throw error;
    }
}

/**
 * Retrieves user profile from database
 * 
 * @param {string} userId - Supabase user ID
 * @returns {Promise<object>} - User profile record
 * @throws {Error} - Database or query error
 */
async function getUserProfile(userId) {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();

        if (error) {
            console.error('[Profile Fetch Error]', error);
            throw new Error(ERROR_MESSAGES.PROFILE_CREATION_FAILED);
        }

        return data;

    } catch (error) {
        console.error('[Profile Fetch Error]', error);
        throw error;
    }
}

/**
 * Checks if user account is verified and can access features
 * 
 * Verification Rules:
 * - Admins: Automatically verified on registration
 * - Doctors: Must be verified by admin before login
 * 
 * @param {object} profile - User profile object
 * @returns {object} - { canAccess: boolean, reason?: string }
 */
function checkAccountVerification(profile) {
    if (profile.role === 'doctor') {
        if (profile.verification_status === 'pending') {
            return {
                canAccess: false,
                reason: ERROR_MESSAGES.ACCOUNT_PENDING_VERIFICATION
            };
        }
        if (profile.verification_status === 'rejected') {
            return {
                canAccess: false,
                reason: ERROR_MESSAGES.ACCOUNT_REJECTED
            };
        }
    }

    // Admins are always verified, doctors that are verified can access
    return { canAccess: true };
}

// ============================================================================
// LOGIN HANDLER
// ============================================================================

/**
 * Handles user login form submission
 * 
 * Flow:
 * 1. Validate form inputs
 * 2. Sign in with Supabase Auth
 * 3. Fetch user profile
 * 4. Check verification status
 * 5. Redirect if verified, sign out if not
 * 
 * Error Handling:
 * - Network errors (timeout, connection failed)
 * - Invalid credentials
 * - Account not verified
 * - Database query errors
 * 
 * @param {Event} e - Form submit event
 */
async function handleLogin(e) {
    e.preventDefault();
    hideMessages();

    // Get form elements
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const loginBtn = document.getElementById('loginBtn');
    const originalBtnText = 'Login';

    // Validate inputs
    if (!email || !isValidEmail(email)) {
        showError(ERROR_MESSAGES.INVALID_EMAIL);
        return;
    }

    if (!password) {
        showError('Password is required');
        return;
    }

    // Set loading state
    setButtonLoading(loginBtn, true, 'Logging in...', originalBtnText);

    try {
        // Step 1: Authenticate with Supabase Auth
        const authData = await signInUser(email, password);

        // Step 2: Fetch user profile to check verification
        const profile = await getUserProfile(authData.user.id);

        // Step 3: Check verification status
        const verification = checkAccountVerification(profile);
        if (!verification.canAccess) {
            // Sign out immediately if not verified
            await supabase.auth.signOut();
            showError(verification.reason);
            setButtonLoading(loginBtn, false, originalBtnText, originalBtnText);
            return;
        }

        // Step 4: Login successful, show success message
        showSuccess('Login successful! Redirecting...');

        // Redirect after delay
        setTimeout(() => {
            window.location.href = 'dashboard.html';
        }, AUTH_CONFIG.REDIRECT_DELAY);

    } catch (error) {
        console.error('[Login Handler Error]', error);

        // Show user-friendly error message
        let errorMessage = error.message;
        if (error.message.includes('fetch') || error.message.includes('network')) {
            errorMessage = ERROR_MESSAGES.NETWORK_ERROR;
        }

        showError(errorMessage);
        setButtonLoading(loginBtn, false, originalBtnText, originalBtnText);
    }
}

// ============================================================================
// REGISTRATION HANDLER
// ============================================================================

/**
 * Handles user registration form submission
 * 
 * Complete Registration Flow:
 * 1. Validate all form inputs
 * 2. Create user account in Supabase Auth
 * 3. Database trigger automatically creates profile
 * 4. Upload license file to storage
 * 5. Update profile with license_url
 * 6. Set verification_status to 'pending' for doctors
 * 7. Redirect to login
 * 
 * Error Handling at each step:
 * - Input validation errors
 * - Auth errors (email taken, weak password, etc.)
 * - File upload errors
 * - Database update errors
 * - And more
 * 
 * Security:
 * - Password validation enforced
 * - File type and size validation
 * - License stored separately from auth data
 * - RLS policies protect data access
 * 
 * @param {Event} e - Form submit event
 */
async function handleRegister(e) {
    e.preventDefault();
    hideMessages();

    // Get form elements
    const fullName = document.getElementById('fullName').value.trim();
    const email = document.getElementById('email').value.trim();
    const role = document.getElementById('role').value;
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const registerBtn = document.getElementById('registerBtn');
    const originalBtnText = 'Register';

    // Get role-specific inputs
    let doctorId, clinicPermitId, licenseFile, licenseUrl;

    if (role === 'doctor') {
        doctorId = document.getElementById('doctorId').value.trim();
        licenseFile = document.getElementById('doctorLicense')?.files[0];
    } else if (role === 'admin') {
        clinicPermitId = document.getElementById('clinicPermitId').value.trim();
        licenseFile = document.getElementById('clinicLicense')?.files[0];
    }

    // Step 1: Validate all inputs
    const validation = validateRegistrationForm({
        fullName,
        email,
        role,
        password,
        confirmPassword,
        doctorId,
        clinicPermitId,
        licenseFile
    });

    if (!validation.valid) {
        showError(validation.error);
        return;
    }

    // Set loading state
    setButtonLoading(registerBtn, true, 'Registering...', originalBtnText);

    try {
        // Step 2: Create user account
        console.log('[Registration] Step 1: Creating user account');
        const authData = await createUserAccount(
            email,
            password,
            fullName,
            role,
            {
                doctor_id: doctorId,
                clinic_permit_id: clinicPermitId
            }
        );

        const userId = authData.user.id;

        // Step 3: Upload license file to storage
        console.log('[Registration] Step 2: Uploading license file');
        licenseUrl = await uploadLicenseFile(userId, role, licenseFile);

        // Step 4: Update profile with license URL
        console.log('[Registration] Step 3: Updating profile with license');
        await updateProfileWithLicense(userId, licenseUrl, {
            doctor_id: doctorId || null,
            clinic_permit_id: clinicPermitId || null,
        });

        // Step 5: Show success and redirect
        showSuccess('Registration successful! Redirecting to login...');

        setTimeout(() => {
            window.location.href = 'login.html';
        }, AUTH_CONFIG.REDIRECT_DELAY);

    } catch (error) {
        console.error('[Registration Error]', error);

        // Handle different error types
        let errorMessage = error.message || ERROR_MESSAGES.REGISTRATION_FAILED;

        // Clean error message for display
        if (errorMessage.includes('fetch') || errorMessage.includes('network')) {
            errorMessage = ERROR_MESSAGES.NETWORK_ERROR;
        }

        showError(errorMessage);
        setButtonLoading(registerBtn, false, originalBtnText, originalBtnText);
    }
}

// ============================================================================
// UI INTERACTION HANDLERS
// ============================================================================

/**
 * Updates visibility of role-specific form fields
 * Shows/hides doctor ID and license fields when role changes
 */
function updateRoleFields() {
    const role = document.getElementById('role').value;
    const doctorFields = document.getElementById('doctorFields');
    const adminFields = document.getElementById('adminFields');

    if (doctorFields) {
        doctorFields.style.display = role === 'doctor' ? 'block' : 'none';
    }
    if (adminFields) {
        adminFields.style.display = role === 'admin' ? 'block' : 'none';
    }
}

/**
 * Displays file name when user selects a license file
 * Provides better UX feedback
 */
function handleFileSelection(inputId, displayId) {
    const fileInput = document.getElementById(inputId);
    if (!fileInput) return;

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        const displayElement = document.getElementById(displayId);

        if (displayElement && file) {
            displayElement.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`;
        }
    });
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initializes authentication module when DOM is ready
 * Attaches event listeners and sets up form handlers
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log('[Auth Module] Initializing...');

    // Setup login form handler
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
        console.log('[Auth] Login form handler attached');
    }

    // Setup register form handler
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', handleRegister);
        console.log('[Auth] Register form handler attached');
    }

    // Setup role selector handler
    const roleSelect = document.getElementById('role');
    if (roleSelect) {
        roleSelect.addEventListener('change', updateRoleFields);
        // Initialize on page load
        updateRoleFields();
        console.log('[Auth] Role selector handler attached');
    }

    // Setup file selection handlers
    handleFileSelection('doctorLicense', 'doctorLicenseDisplay');
    handleFileSelection('clinicLicense', 'clinicLicenseDisplay');

    console.log('[Auth Module] Initialization complete');
});

// Export functions for testing (optional)
export {
    createUserAccount,
    signInUser,
    uploadLicenseFile,
    updateProfileWithLicense,
    validatePassword,
    validateFile,
    validateRegistrationForm
};