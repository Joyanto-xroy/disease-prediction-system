import { supabase } from './supabase-config.js';

async function checkAuth() {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        window.location.href = 'login.html';
        return null;
    }

    return session;
}

async function loadUserProfile() {
    try {
        const session = await checkAuth();
        if (!session) return;

        const { data: profile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .maybeSingle();

        if (error) throw error;

        if (profile) {
            document.getElementById('userName').textContent = profile.full_name;
            document.getElementById('userRole').textContent = profile.role;
            document.getElementById('displayName').textContent = profile.full_name;
            document.getElementById('displayEmail').textContent = profile.email;
            document.getElementById('displayRole').textContent = profile.role.charAt(0).toUpperCase() + profile.role.slice(1);

            const createdDate = new Date(profile.created_at);
            document.getElementById('displayCreated').textContent = createdDate.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        }
    } catch (error) {
        console.error('Error loading profile:', error);
    }
}

async function handleLogout() {
    try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;

        window.location.href = 'login.html';
    } catch (error) {
        console.error('Error logging out:', error);
        alert('Error logging out. Please try again.');
    }
}

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        handleLogout();
    });
}

loadUserProfile();
