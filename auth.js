import { supabase } from './supabase-config.js';

function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    const successDiv = document.getElementById('successMessage');

    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.classList.add('show');
    }
    if (successDiv) {
        successDiv.classList.remove('show');
    }
}

// helper to build a user-friendly message from a Supabase error object
function formatSupabaseError(err) {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    let msg = err.message || '';
    // common scenario: schema not set up
    if (msg.includes('relation "profiles" does not exist') ||
        msg.includes('permission denied for relation profiles')) {
        return 'Database not initialized. Run the SQL setup script in your Supabase project.';
    }
    if (err.details) msg += ' ' + err.details;
    if (err.hint) msg += ' ' + err.hint;
    return msg || JSON.stringify(err);
}

function showSuccess(message) {
    const errorDiv = document.getElementById('errorMessage');
    const successDiv = document.getElementById('successMessage');

    if (successDiv) {
        successDiv.textContent = message;
        successDiv.classList.add('show');
    }
    if (errorDiv) {
        errorDiv.classList.remove('show');
    }
}

function hideMessages() {
    const errorDiv = document.getElementById('errorMessage');
    const successDiv = document.getElementById('successMessage');

    if (errorDiv) errorDiv.classList.remove('show');
    if (successDiv) successDiv.classList.remove('show');
}

async function handleLogin(e) {
    e.preventDefault();
    hideMessages();

    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const loginBtn = document.getElementById('loginBtn');

    loginBtn.disabled = true;
    loginBtn.textContent = 'Logging in...';

    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password,
        });

        if (error) {
            console.error('signInWithPassword error object:', error);
            throw error;
        }

        // Read role and verification_status from JWT user_metadata.
        // This avoids querying the profiles table, which would trigger
        // the recursive RLS policy and cause an infinite recursion error.
        const meta = data.user.user_metadata || {};
        const role = meta.role || 'doctor';
        const verificationStatus = meta.verification_status;

        // For doctors, we also need to check verification from the DB
        // but only if metadata doesn't have it (fallback: try profiles table).
        // If the metadata has the verification_status, use it directly.
        if (role === 'doctor') {
            // Try reading from metadata first
            if (verificationStatus && verificationStatus !== 'verified') {
                await supabase.auth.signOut();
                showError('Your account is pending verification by an administrator. Please wait for approval.');
                loginBtn.disabled = false;
                loginBtn.textContent = 'Login';
                return;
            }

            // If metadata doesn't have verification_status, query profiles with a safer approach
            if (!verificationStatus) {
                try {
                    const { data: profile } = await supabase
                        .from('profiles')
                        .select('verification_status')
                        .eq('id', data.user.id)
                        .maybeSingle();

                    if (profile && profile.verification_status !== 'verified') {
                        await supabase.auth.signOut();
                        showError('Your account is pending verification by an administrator. Please wait for approval.');
                        loginBtn.disabled = false;
                        loginBtn.textContent = 'Login';
                        return;
                    }
                } catch (profileErr) {
                    // If profile query fails (e.g. due to RLS), allow login to proceed
                    // The dashboard will handle any access control
                    console.warn('Could not verify doctor status via profiles table:', profileErr.message);
                }
            }
        }

        showSuccess('Login successful! Redirecting...');

        setTimeout(() => {
            window.location.href = 'dashboard.html';
        }, 1000);

    } catch (error) {
        console.error('Login failed:', error);
        let msg = formatSupabaseError(error);
        showError(msg);
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
    }
}

async function handleRegister(e) {
    e.preventDefault();
    hideMessages();

    const fullName = document.getElementById('fullName').value.trim();
    const email = document.getElementById('email').value.trim();
    const role = document.getElementById('role').value;
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const registerBtn = document.getElementById('registerBtn');

    if (!role) { showError('Please select a role'); return; }
    if (password !== confirmPassword) { showError('Passwords do not match'); return; }
    if (password.length < 8) { showError('Password must be at least 8 characters'); return; }

    // role-specific values
    let extraData = {};
    let fileInput = null;

    if (role === 'doctor') {
        const doctorId = document.getElementById('doctorId').value.trim();
        const spec = document.getElementById('specialization') ? document.getElementById('specialization').value.trim() : '';
        fileInput = document.getElementById('doctorLicense');
        if (!doctorId) { showError('Please enter your Doctor ID'); return; }
        if (!fileInput || fileInput.files.length === 0) { showError('Please upload your doctor license photo'); return; }
        extraData.doctor_id = doctorId;
        if (spec) extraData.specialization = spec;
        // Doctors start as pending; admin must approve
        extraData.verification_status = 'pending';
    }

    if (role === 'admin') {
        // Admins are immediately verified
        extraData.verification_status = 'verified';
    }

    registerBtn.disabled = true;
    registerBtn.textContent = 'Registering...';

    try {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: { data: { full_name: fullName, role, ...extraData } }
        });

        if (error) {
            console.error('signUp error object:', error);
            throw error;
        }

        // Upload license file for doctors
        if (fileInput && fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const ext = file.name.split('.').pop();
            const path = data.user.id + '/' + role + '_license.' + ext;
            const { error: uploadError } = await supabase.storage.from('licenses').upload(path, file);
            if (uploadError) {
                console.warn('License upload failed:', uploadError.message);
            } else {
                const { data: urlData } = supabase.storage.from('licenses').getPublicUrl(path);
                await supabase.auth.updateUser({ data: { license_url: urlData.publicUrl } });
            }
        }

        if (role === 'admin') {
            showSuccess('Admin account created! Redirecting to login...');
        } else {
            showSuccess('Registration submitted! Please wait for admin verification before logging in.');
        }

        setTimeout(() => { window.location.href = 'login.html'; }, 2500);

    } catch (error) {
        // display more information if available
        console.error('Registration failed:', error);
        let msg = formatSupabaseError(error);
        showError(msg);
        registerBtn.disabled = false;
        registerBtn.textContent = 'Register';
    }
}

const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
}

// show/hide role-specific inputs
function updateRoleFields() {
    const role = document.getElementById('role').value;
    const doctorFields = document.getElementById('doctorFields');
    const adminFields = document.getElementById('adminFields');

    if (doctorFields) doctorFields.style.display = role === 'doctor' ? 'block' : 'none';
    if (adminFields) adminFields.style.display = role === 'admin' ? 'block' : 'none';
}

// quick check at load time to catch uninitialized database early
async function sanityCheck() {
    try {
        const { data, error } = await supabase.from('profiles').select('id').limit(1);
        if (error) {
            console.error('sanity check error:', error);
            if (error.message && error.message.includes('relation "profiles" does not exist')) {
                showError('Database not initialized. Please run the SQL setup script in your Supabase project.');
            }
        }
    } catch (e) {
        console.error('unexpected error during sanity check', e);
    }
}

sanityCheck();

const roleSelect = document.getElementById('role');
if (roleSelect) {
    roleSelect.addEventListener('change', updateRoleFields);
    // run once to set correct visibility if the form is repopulated
    updateRoleFields();
}

const registerForm = document.getElementById('registerForm');
if (registerForm) {
    registerForm.addEventListener('submit', handleRegister);
}
