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

        if (error) throw error;

        showSuccess('Login successful! Redirecting...');

        setTimeout(() => {
            window.location.href = 'dashboard.html';
        }, 1000);

    } catch (error) {
        showError(error.message || 'Login failed. Please check your credentials.');
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
    }
}

async function handleRegister(e) {
    e.preventDefault();
    hideMessages();

    const fullName = document.getElementById('fullName').value;
    const email = document.getElementById('email').value;
    const role = document.getElementById('role').value;
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const registerBtn = document.getElementById('registerBtn');

    // role‑specific values
    let extraData = {};
    let fileInput = null;

    if (role === 'doctor') {
        const doctorId = document.getElementById('doctorId').value;
        fileInput = document.getElementById('doctorLicense');
        if (!doctorId) {
            showError('Please enter your doctor ID');
            return;
        }
        if (!fileInput || fileInput.files.length === 0) {
            showError('Please upload your doctor license photo');
            return;
        }
        extraData.doctor_id = doctorId;
    } else if (role === 'admin') {
        const clinicPermitId = document.getElementById('clinicPermitId').value;
        fileInput = document.getElementById('clinicLicense');
        if (!clinicPermitId) {
            showError('Please enter your clinic permit ID');
            return;
        }
        if (!fileInput || fileInput.files.length === 0) {
            showError('Please upload your clinic license photo');
            return;
        }
        extraData.clinic_permit_id = clinicPermitId;
    }

    if (!role) {
        showError('Please select a role');
        return;
    }

    if (password !== confirmPassword) {
        showError('Passwords do not match');
        return;
    }

    if (password.length < 6) {
        showError('Password must be at least 6 characters');
        return;
    }

    registerBtn.disabled = true;
    registerBtn.textContent = 'Registering...';

    try {
        // initial signup and metadata
        const { data, error } = await supabase.auth.signUp({
            email: email,
            password: password,
            options: {
                data: {
                    full_name: fullName,
                    role: role,
                    ...extraData
                }
            }
        });

        if (error) throw error;

        // if we have a file to upload, save it in storage and update the user
        if (fileInput && fileInput.files.length > 0) {
            const userId = data.user.id;
            const file = fileInput.files[0];
            const ext = file.name.split('.').pop();
            const path = `${userId}/${role}_license.${ext}`;

            const { error: uploadError } = await supabase.storage.from('licenses').upload(path, file);
            if (uploadError) throw uploadError;

            const { data: urlData } = supabase.storage.from('licenses').getPublicUrl(path);
            const licenseUrl = urlData.publicUrl;

            // update user metadata with license URL
            await supabase.auth.updateUser({ data: { license_url: licenseUrl } });
        }

        showSuccess('Registration successful! Redirecting to login...');

        setTimeout(() => {
            window.location.href = 'login.html';
        }, 2000);

    } catch (error) {
        showError(error.message || 'Registration failed. Please try again.');
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
