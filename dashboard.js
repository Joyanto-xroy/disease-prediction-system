import { supabase } from './supabase-config.js';

let currentUser = null;
let currentProfile = null;

// ─── Auth ──────────────────────────────────────────────────────────────────

async function checkAuth() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return null; }
    currentUser = session.user;
    return session;
}

async function loadUserProfile() {
    const session = await checkAuth();
    if (!session) return;

    let profile = null;
    try {
        const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
        if (!error) profile = data;
    } catch (_) { }

    if (!profile) {
        const meta = session.user.user_metadata || {};
        profile = {
            id: session.user.id,
            email: session.user.email,
            full_name: meta.full_name || session.user.email,
            role: meta.role || 'doctor',
            verification_status: meta.verification_status || 'pending',
            created_at: session.user.created_at,
        };
    }

    currentProfile = profile;
    showAppropriateDashboard(profile);
}

function showAppropriateDashboard(profile) {
    document.getElementById('adminDashboard').style.display = 'none';
    document.getElementById('doctorDashboard').style.display = 'none';
    document.getElementById('pendingScreen').style.display = 'none';

    if (profile.role === 'admin' && profile.verification_status === 'verified') {
        document.getElementById('adminUserName').textContent = profile.full_name;
        document.getElementById('navUserName').textContent = profile.full_name;
        document.getElementById('adminDashboard').style.display = 'block';
        loadAdminDashboard();
    } else if (profile.role === 'doctor' && profile.verification_status === 'verified') {
        document.getElementById('doctorUserName').textContent = profile.full_name;
        document.getElementById('navUserName').textContent = 'Dr. ' + profile.full_name;
        document.getElementById('doctorDashboard').style.display = 'block';
        loadDoctorDashboard();
    } else {
        document.getElementById('pendingScreen').style.display = 'block';
    }
}

// ─── Admin Dashboard ────────────────────────────────────────────────────────

async function loadAdminDashboard() {
    await Promise.all([
        loadAdminStats(),
        loadPendingDoctors(),
        loadDoctorsList(),
        loadPatientsList(),
        loadCharts()
    ]);
}

async function loadAdminStats() {
    try {
        const { data, error } = await supabase.rpc('admin_get_stats');
        if (error) throw error;
        const s = (data && data[0]) ? data[0] : {};
        document.getElementById('totalDoctors').textContent = s.total_doctors || 0;
        document.getElementById('pendingVerifications').textContent = s.pending_doctors || 0;
        document.getElementById('totalPatients').textContent = s.total_patients || 0;
        document.getElementById('totalVisits').textContent = s.total_visits || 0;
    } catch (e) {
        console.error('Stats error', e);
        // Fallback: clear stats silently
    }
}

async function loadCharts() {
    try {
        // Doctor Activity Chart — use RPC to bypass RLS
        const { data: doctors } = await supabase.rpc('admin_get_all_doctors');
        if (doctors && doctors.length > 0) {
            const verified = doctors.filter(d => d.verification_status === 'verified');
            const visitCounts = await Promise.all(verified.map(async (d) => {
                const { count } = await supabase.from('patient_visits').select('*', { count: 'exact', head: true }).eq('doctor_id', d.id);
                return { name: d.full_name, count: count || 0 };
            }));
            const filtered = visitCounts.filter(v => v.count > 0);
            const chartDoctors = filtered.length > 0 ? filtered : visitCounts;
            const ctx1 = document.getElementById('doctorActivityChart').getContext('2d');
            new Chart(ctx1, {
                type: 'bar',
                data: {
                    labels: chartDoctors.map(v => v.name),
                    datasets: [{
                        label: 'Visits Conducted',
                        data: chartDoctors.map(v => v.count),
                        backgroundColor: 'rgba(37,99,235,0.7)',
                        borderColor: '#2563eb',
                        borderWidth: 1,
                        borderRadius: 6,
                    }]
                },
                options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
            });
        } else {
            document.getElementById('doctorActivityChart').parentElement.innerHTML += '<p style="color:#94a3b8;text-align:center;padding:1rem;">No doctors yet.</p>';
        }

        // Symptoms Chart — uses patient_visits which falls under doctor/admin policy
        const { data: visits } = await supabase.from('patient_visits').select('symptoms').not('symptoms', 'is', null).limit(200);
        if (visits && visits.length > 0) {
            const freq = {};
            const KEYWORDS = ['fever', 'cough', 'headache', 'pain', 'fatigue', 'vomiting', 'diarrhea', 'nausea', 'shortness', 'chest', 'rash', 'dizziness', 'swelling', 'breathlessness'];
            visits.forEach(v => {
                const lower = (v.symptoms || '').toLowerCase();
                KEYWORDS.forEach(k => { if (lower.includes(k)) freq[k] = (freq[k] || 0) + 1; });
            });
            const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 8);
            if (sorted.length > 0) {
                const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];
                const ctx2 = document.getElementById('symptomsChart').getContext('2d');
                new Chart(ctx2, {
                    type: 'doughnut',
                    data: {
                        labels: sorted.map(s => s[0].charAt(0).toUpperCase() + s[0].slice(1)),
                        datasets: [{ data: sorted.map(s => s[1]), backgroundColor: COLORS, borderWidth: 2 }]
                    },
                    options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
                });
            } else {
                document.getElementById('symptomsChart').parentElement.innerHTML += '<p style="color:#94a3b8;text-align:center;padding:1rem;">No symptom data yet.</p>';
            }
        } else {
            document.getElementById('symptomsChart').parentElement.innerHTML += '<p style="color:#94a3b8;text-align:center;padding:1rem;">No visits recorded yet.</p>';
        }
    } catch (e) { console.error('Chart error', e); }
}

// Helper: query profiles bypassing RLS via RPC, fallback to direct query
async function queryAllDoctors() {
    // Try the SECURITY DEFINER function first
    const { data: rpcData, error: rpcErr } = await supabase.rpc('admin_get_all_doctors');
    if (!rpcErr) return rpcData || [];
    // Fallback: direct query (works if RLS policies were loosened by the setup SQL)
    const { data: directData } = await supabase.from('profiles').select('*').eq('role', 'doctor').order('created_at', { ascending: false });
    return directData || [];
}

// Pending Registrations
window.loadPendingDoctors = async function () {
    const el = document.getElementById('pendingDoctorsList');
    el.innerHTML = '<p class="empty-state">Loading...</p>';
    try {
        let data = [];
        // Try RPC first
        const { data: rpcData, error: rpcErr } = await supabase.rpc('admin_get_pending_doctors');
        if (!rpcErr) {
            data = rpcData || [];
        } else {
            // RPC not available — fall back to direct table query
            const { data: direct, error: directErr } = await supabase
                .from('profiles').select('*')
                .eq('role', 'doctor').eq('verification_status', 'pending')
                .order('created_at');
            if (directErr) throw directErr;
            data = direct || [];
        }
        if (data.length === 0) { el.innerHTML = '<p class="empty-state">✅ No pending registrations.</p>'; return; }
        el.innerHTML = buildTable(
            ['Name', 'Email', 'Doctor ID', 'Specialization', 'Registered', 'Actions'],
            data.map(d => [
                escHtml(d.full_name),
                escHtml(d.email),
                escHtml(d.doctor_id || 'N/A'),
                escHtml(d.specialization || 'N/A'),
                new Date(d.created_at).toLocaleDateString(),
                '<button onclick="verifyDoctor(\'' + d.id + '\')" class="btn btn-small btn-success">✅ Approve</button> ' +
                '<button onclick="rejectDoctor(\'' + d.id + '\')" class="btn btn-small btn-danger">❌ Reject</button> ' +
                '<button onclick="viewDoctorDetails(\'' + d.id + '\')" class="btn btn-small btn-secondary">Details</button>'
            ])
        );
    } catch (e) {
        console.error('loadPendingDoctors error:', e);
        el.innerHTML = '<p class="empty-state" style="color:#ef4444;">⚠️ Cannot load data: ' + e.message + '</p>';
    }
};

// Doctor Management List
window.loadDoctorsList = async function () {
    const el = document.getElementById('doctorsList');
    el.innerHTML = '<p class="empty-state">Loading...</p>';
    try {
        const data = await queryAllDoctors();
        if (!data || data.length === 0) { el.innerHTML = '<p class="empty-state">No doctors registered yet.</p>'; return; }
        el.innerHTML = buildTable(
            ['Name', 'Email', 'Status', 'Doctor ID', 'Actions'],
            data.map(d => [
                escHtml(d.full_name),
                escHtml(d.email),
                '<span class="status-' + d.verification_status + '">' + d.verification_status + '</span>',
                escHtml(d.doctor_id || 'N/A'),
                '<button onclick="viewDoctorDetails(\'' + d.id + '\')" class="btn btn-small btn-secondary">View</button> ' +
                (d.verification_status === 'pending' ?
                    '<button onclick="verifyDoctor(\'' + d.id + '\')" class="btn btn-small btn-success">Approve</button> ' +
                    '<button onclick="rejectDoctor(\'' + d.id + '\')" class="btn btn-small btn-danger">Reject</button> ' : '') +
                '<button onclick="deleteDoctor(\'' + d.id + '\')" class="btn btn-small btn-danger">Delete</button>'
            ])
        );
    } catch (e) {
        console.error('loadDoctorsList error:', e);
        el.innerHTML = '<p class="empty-state" style="color:#ef4444;">⚠️ Cannot load data: ' + e.message + '</p>';
    }
};

window.verifyDoctor = async function (doctorId) {
    if (!confirm('Approve this doctor?')) return;
    try {
        const { data: rpcData, error: rpcErr } = await supabase.rpc('admin_verify_doctor', { p_doctor_id: doctorId });
        if (rpcErr) {
            console.error('RPC Error (admin_verify_doctor):', rpcErr);
            // Try direct update as a fallback (may fail if RLS blocks it)
            const { data, error } = await supabase.from('profiles').update({ verification_status: 'verified' }).eq('id', doctorId).select('id,verification_status').maybeSingle();
            if (error) {
                console.error('Direct Update Error (verifyDoctor):', error);
                alert('Approve failed: ' + (rpcErr.message || rpcErr.toString()) + '\n' + (error.message || error.toString()));
                return;
            }
        }

        // Refresh UI based on admin RPC results (bypass RLS for reading)
        await loadPendingDoctors();
        await loadDoctorsList();
        alert('Doctor approved successfully.');
    } catch (e) {
        console.error('Error approving doctor:', e);
        alert('Error approving doctor: ' + e.message);
    }
};

window.rejectDoctor = async function (doctorId) {
    if (!confirm('Reject this doctor?')) return;
    try {
        const { data: rpcData, error: rpcErr } = await supabase.rpc('admin_reject_doctor', { p_doctor_id: doctorId });
        if (rpcErr) {
            console.error('RPC Error (admin_reject_doctor):', rpcErr);
            const { data, error } = await supabase.from('profiles').update({ verification_status: 'rejected' }).eq('id', doctorId).select('id,verification_status').maybeSingle();
            if (error) {
                console.error('Direct Update Error (rejectDoctor):', error);
                alert('Reject failed: ' + (rpcErr.message || rpcErr.toString()) + '\n' + (error.message || error.toString()));
                return;
            }
        }

        // Refresh UI based on admin RPC results (bypass RLS for reading)
        await loadPendingDoctors();
        await loadDoctorsList();
        alert('Doctor rejected successfully.');
    } catch (e) {
        console.error('Error rejecting doctor:', e);
        alert('Error rejecting doctor: ' + e.message);
    }
};

window.deleteDoctor = async function (doctorId) {
    if (!confirm('Delete this doctor?')) return;
    try {
        // Prefer RPC that runs with elevated privileges
        const { error: rpcErr } = await supabase.rpc('admin_delete_doctor', { p_doctor_id: doctorId });
        if (rpcErr) {
            console.error('RPC Error (admin_delete_doctor):', rpcErr);
            // Fallback to direct delete (may be blocked by RLS)
            const { error } = await supabase.from('profiles').delete().eq('id', doctorId);
            if (error) {
                console.error('Direct Delete Error (deleteDoctor):', error);
                alert('Delete failed: ' + (rpcErr.message || rpcErr.toString()) + '\n' + (error.message || error.toString()));
                return;
            }
        }

        // Refresh the UI; list should update if deletion succeeded
        await loadDoctorsList();
        alert('Doctor deleted successfully.');
    } catch (e) {
        console.error('Error deleting doctor:', e);
        alert('Error deleting doctor: ' + e.message);
    }
};

window.viewDoctorDetails = async function (doctorId) {
    try {
        // Fetch from the already-loaded doctors list (or fall back to RPC)
        const { data: allDocs } = await supabase.rpc('admin_get_all_doctors');
        const doctor = allDocs ? allDocs.find(d => d.id === doctorId) : null;
        if (!doctor) { alert('Doctor not found.'); return; }
        const { count: patCount } = await supabase.from('patients').select('*', { count: 'exact', head: true }).eq('created_by', doctorId);
        const { count: visCount } = await supabase.from('patient_visits').select('*', { count: 'exact', head: true }).eq('doctor_id', doctorId);
        let licenseLink = '<p style="color:#94a3b8;margin-top:1rem;">No license uploaded.</p>';

        // If profile contains a stored path or a public URL, generate a short-lived signed URL to view it.
        const licensePath = doctor.license_url;
        if (licensePath) {
            try {
                // If license_url is already an absolute URL, show it directly.
                const isAbsolute = /^https?:\/\//i.test(licensePath);
                if (isAbsolute) {
                    licenseLink = '<div style="margin-top:1rem;"><a href="' + escHtml(licensePath) + '" target="_blank" class="btn btn-primary">View License</a></div>';
                } else {
                    const { data: signedUrl, error: signErr } = await supabase.storage.from('licenses').createSignedUrl(licensePath, 3600);
                    if (!signErr && signedUrl?.signedUrl) {
                        licenseLink = '<div style="margin-top:1rem;"><a href="' + signedUrl.signedUrl + '" target="_blank" class="btn btn-primary">View License</a></div>';
                    } else {
                        licenseLink = '<p style="color:#ef4444;margin-top:1rem;">License uploaded but cannot generate view link.</p>';
                    }
                }
            } catch (e) {
                licenseLink = '<p style="color:#ef4444;margin-top:1rem;">License uploaded but cannot generate view link.</p>';
            }
        } else {
            // Try to find an uploaded file in storage under the doctor's folder
            try {
                const { data: list, error: listErr } = await supabase.storage.from('licenses').list(doctorId, { limit: 1 });
                if (!listErr && list && list.length > 0) {
                    const path = doctorId + '/' + list[0].name;
                    const { data: signedUrl, error: signErr } = await supabase.storage.from('licenses').createSignedUrl(path, 3600);
                    if (!signErr && signedUrl?.signedUrl) {
                        licenseLink = '<div style="margin-top:1rem;"><a href="' + signedUrl.signedUrl + '" target="_blank" class="btn btn-primary">View License</a></div>';
                    }
                }
            } catch (_e) {
                // ignore; leave default message
            }
        }
        document.getElementById('doctorModalContent').innerHTML =
            '<div class="info-row"><span class="info-label">Name</span><span class="info-value">' + escHtml(doctor.full_name) + '</span></div>' +
            '<div class="info-row"><span class="info-label">Email</span><span class="info-value">' + escHtml(doctor.email) + '</span></div>' +
            '<div class="info-row"><span class="info-label">Doctor ID</span><span class="info-value">' + escHtml(doctor.doctor_id || 'N/A') + '</span></div>' +
            '<div class="info-row"><span class="info-label">Status</span><span class="info-value status-' + doctor.verification_status + '">' + doctor.verification_status + '</span></div>' +
            '<div class="info-row"><span class="info-label">Clinic Permit</span><span class="info-value">' + escHtml(doctor.clinic_permit_id || 'N/A') + '</span></div>' +
            '<div class="info-row"><span class="info-label">Patients Added</span><span class="info-value">' + (patCount || 0) + '</span></div>' +
            '<div class="info-row"><span class="info-label">Visits Conducted</span><span class="info-value">' + (visCount || 0) + '</span></div>' +
            licenseLink;
        openModal('doctorModal');
    } catch (e) { alert('Error loading doctor details.'); }
};

// Add Doctor by Admin
window.openAddDoctorModal = function () { openModal('addDoctorModal'); };
document.getElementById('addDoctorForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const name = document.getElementById('newDoctorName').value;
    const email = document.getElementById('newDoctorEmail').value;
    const spec = document.getElementById('newDoctorSpec').value;
    const did = document.getElementById('newDoctorId').value;
    const pw = document.getElementById('newDoctorPassword').value;
    try {
        // We use auth signUp – the trigger will auto-insert profile
        const { data, error } = await supabase.auth.signUp({
            email, password: pw,
            options: { data: { full_name: name, role: 'doctor', doctor_id: did, specialization: spec } }
        });
        if (error) throw error;
        // Immediately mark as verified since admin is adding them
        if (data.user) {
            await supabase.from('profiles').update({ verification_status: 'verified' }).eq('id', data.user.id);
        }
        alert('Doctor created and verified successfully!');
        closeModal('addDoctorModal');
        document.getElementById('addDoctorForm').reset();
        await Promise.all([loadDoctorsList(), loadAdminStats()]);
    } catch (err) { alert('Error creating doctor: ' + err.message); }
});

// ─── Patient Management ─────────────────────────────────────────────────────

window.loadPatientsList = async function () {
    try {
        let query = supabase.from('patients').select('*, profiles(full_name)').order('created_at', { ascending: false });
        if (currentProfile && currentProfile.role === 'doctor') {
            query = query.eq('created_by', currentUser.id);
        }
        const { data, error } = await query;
        if (error) throw error;

        const el = document.getElementById('patientsList');
        if (!data || data.length === 0) { el.innerHTML = '<p class="empty-state">No patients found.</p>'; return; }

        const isAdmin = currentProfile && currentProfile.role === 'admin';
        el.innerHTML = buildTable(
            ['Name', 'DOB', 'Gender', 'Phone', ...(isAdmin ? ['Added By'] : []), 'Actions'],
            data.map(p => [
                escHtml(p.full_name),
                p.date_of_birth ? new Date(p.date_of_birth).toLocaleDateString() : 'N/A',
                p.gender || 'N/A',
                escHtml(p.phone || 'N/A'),
                ...(isAdmin ? [p.profiles ? escHtml(p.profiles.full_name) : 'N/A'] : []),
                '<button onclick="viewPatient(\'' + p.id + '\')" class="btn btn-small btn-primary">History</button> ' +
                '<button onclick="editPatient(\'' + p.id + '\')" class="btn btn-small btn-secondary">Edit</button> ' +
                (!isAdmin ? '<button onclick="addVisit(\'' + p.id + '\')" class="btn btn-small btn-success">Add Visit</button> ' +
                    '<button onclick="prescribeMedication(\'' + p.id + '\')" class="btn btn-small btn-warning">Rx</button> ' : '') +
                (isAdmin ? '<button onclick="deletePatient(\'' + p.id + '\')" class="btn btn-small btn-danger">Delete</button>' : '')
            ])
        );

        // Update count badges
        if (currentProfile && currentProfile.role === 'doctor') {
            document.getElementById('myPatientsCount').textContent = data.length;
        }
    } catch (e) { console.error('Patients list error', e); }
};

window.openPatientModal = function () { openPatientModal(); };
window.editPatient = function (id) { openPatientModal(id); };
window.viewPatient = function (id) { viewPatientHistory(id); };
window.addVisit = function (id) { openVisitModal(id); };
window.prescribeMedication = function (id) { openPrescriptionModal(id); };

window.deletePatient = async function (id) {
    if (!confirm('Delete this patient and all their records? This cannot be undone.')) return;
    const { error } = await supabase.from('patients').delete().eq('id', id);
    if (error) { alert('Error: ' + error.message); return; }
    loadPatientsList();
    loadAdminStats();
};

function openPatientModal(patientId = null) {
    document.getElementById('patientId').value = '';
    document.getElementById('patientForm').reset();
    document.getElementById('patientModalTitle').textContent = patientId ? 'Edit Patient' : 'Add New Patient';
    if (patientId) {
        supabase.from('patients').select('*').eq('id', patientId).single().then(({ data }) => {
            if (!data) return;
            document.getElementById('patientId').value = data.id;
            document.getElementById('patientName').value = data.full_name || '';
            document.getElementById('patientDob').value = data.date_of_birth || '';
            document.getElementById('patientGender').value = data.gender || '';
            document.getElementById('patientPhone').value = data.phone || '';
            document.getElementById('patientEmail').value = data.email || '';
            document.getElementById('patientAddress').value = data.address || '';
            document.getElementById('emergencyContactName').value = data.emergency_contact_name || '';
            document.getElementById('emergencyContactPhone').value = data.emergency_contact_phone || '';
            document.getElementById('medicalHistory').value = data.medical_history || '';
            document.getElementById('allergies').value = data.allergies || '';
            document.getElementById('currentMedications').value = data.current_medications || '';
            if (document.getElementById('patientBloodGroup')) {
                document.getElementById('patientBloodGroup').value = data.blood_group || '';
            }
        });
    }
    openModal('patientModal');
}

document.getElementById('patientForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const id = document.getElementById('patientId').value;
    const data = {
        full_name: document.getElementById('patientName').value,
        date_of_birth: document.getElementById('patientDob').value,
        gender: document.getElementById('patientGender').value,
        phone: document.getElementById('patientPhone').value || null,
        email: document.getElementById('patientEmail').value || null,
        address: document.getElementById('patientAddress').value || null,
        emergency_contact_name: document.getElementById('emergencyContactName').value || null,
        emergency_contact_phone: document.getElementById('emergencyContactPhone').value || null,
        medical_history: document.getElementById('medicalHistory').value || null,
        allergies: document.getElementById('allergies').value || null,
        current_medications: document.getElementById('currentMedications').value || null,
        blood_group: document.getElementById('patientBloodGroup') ? document.getElementById('patientBloodGroup').value || null : null,
    };
    try {
        if (id) {
            const { error } = await supabase.from('patients').update(data).eq('id', id);
            if (error) throw error;
            alert('Patient updated!');
        } else {
            data.created_by = currentUser.id;
            const { error } = await supabase.from('patients').insert([data]);
            if (error) throw error;
            alert('Patient added!');
        }
        closeModal('patientModal');
        loadPatientsList();
        if (currentProfile && currentProfile.role === 'admin') loadAdminStats();
    } catch (err) { alert('Error saving patient: ' + err.message); }
});

// ─── Visit Management ───────────────────────────────────────────────────────

function openVisitModal(patientId, visitId = null) {
    document.getElementById('visitPatientId').value = patientId;
    document.getElementById('visitId').value = visitId || '';
    document.getElementById('visitForm').reset();
    document.getElementById('visitDate').value = new Date().toISOString().slice(0, 16);
    document.getElementById('visitModalTitle').textContent = visitId ? 'Edit Visit Record' : 'Record Patient Visit';
    openModal('visitModal');
}

document.getElementById('visitForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const vitals = {
        temperature: document.getElementById('vitalTemp').value || null,
        blood_pressure: document.getElementById('vitalBP').value || null,
        heart_rate: document.getElementById('vitalHR').value || null,
        spo2: document.getElementById('vitalSpO2').value || null,
        weight: document.getElementById('vitalWeight').value || null,
        height: document.getElementById('vitalHeight').value || null,
    };
    const visitData = {
        patient_id: document.getElementById('visitPatientId').value,
        doctor_id: currentUser.id,
        visit_date: document.getElementById('visitDate').value,
        visit_type: document.getElementById('visitType').value,
        symptoms: document.getElementById('visitSymptoms').value,
        test_results: document.getElementById('testResults').value || null,
        diagnosis: document.getElementById('visitDiagnosis').value || null,
        notes: document.getElementById('visitNotes').value || null,
        vitals: vitals,
    };
    try {
        const visitId = document.getElementById('visitId').value;
        if (visitId) {
            const { error } = await supabase.from('patient_visits').update(visitData).eq('id', visitId);
            if (error) throw error;
            alert('Visit record updated!');
        } else {
            const { error } = await supabase.from('patient_visits').insert([visitData]);
            if (error) throw error;
            alert('Visit recorded!');
        }
        closeModal('visitModal');
        loadRecentVisits();
        if (currentProfile && currentProfile.role === 'admin') loadAdminStats();
    } catch (err) { alert('Error saving visit: ' + err.message); }
});

// Patient History Viewer
async function viewPatientHistory(patientId) {
    try {
        const { data: patient } = await supabase.from('patients').select('*').eq('id', patientId).single();
        const { data: visits } = await supabase.from('patient_visits').select('*, profiles(full_name)').eq('patient_id', patientId).order('visit_date', { ascending: false });

        let visitsHtml = '<p style="color:#94a3b8;">No visit records found.</p>';
        if (visits && visits.length > 0) {
            visitsHtml = visits.map(v => {
                const doctorName = v.profiles ? escHtml(v.profiles.full_name) : 'Unknown';
                const vitals = v.vitals || {};
                const vitalsHtml = Object.entries(vitals).filter(([, val]) => val).map(([k, val]) =>
                    '<span class="vital-badge">' + k.replace('_', ' ') + ': ' + escHtml(String(val)) + '</span>'
                ).join('');
                return '<div class="visit-card">' +
                    '<div class="visit-card-header">' +
                    '<strong>' + new Date(v.visit_date).toLocaleString() + '</strong>' +
                    '<span class="visit-type-badge">' + (v.visit_type || 'consultation') + '</span>' +
                    '</div>' +
                    '<div class="info-row"><span class="info-label">Doctor</span><span>' + doctorName + '</span></div>' +
                    (vitalsHtml ? '<div class="vitals-row">' + vitalsHtml + '</div>' : '') +
                    '<div class="info-row"><span class="info-label">Symptoms</span><span>' + escHtml(v.symptoms || 'N/A') + '</span></div>' +
                    '<div class="info-row"><span class="info-label">Diagnosis</span><span>' + escHtml(v.diagnosis || 'N/A') + '</span></div>' +
                    (v.test_results ? '<div class="info-row"><span class="info-label">Test Results</span><span>' + escHtml(v.test_results) + '</span></div>' : '') +
                    (v.notes ? '<div class="info-row"><span class="info-label">Notes</span><span>' + escHtml(v.notes) + '</span></div>' : '') +
                    (currentProfile && currentProfile.role === 'doctor' ?
                        '<div style="margin-top:0.75rem;">' +
                        '<button onclick="openVisitModal(\'' + patientId + '\',\'' + v.id + '\')" class="btn btn-small btn-secondary">Edit Visit</button>' +
                        '</div>' : '') +
                    '</div>';
            }).join('');
        }

        const content =
            '<h4 style="margin-bottom:1rem;">👤 ' + escHtml(patient.full_name) + '</h4>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:1.5rem;">' +
            '<div class="info-row"><span class="info-label">DOB</span><span>' + (patient.date_of_birth ? new Date(patient.date_of_birth).toLocaleDateString() : 'N/A') + '</span></div>' +
            '<div class="info-row"><span class="info-label">Gender</span><span>' + (patient.gender || 'N/A') + '</span></div>' +
            '<div class="info-row"><span class="info-label">Blood Group</span><span>' + escHtml(patient.blood_group || 'N/A') + '</span></div>' +
            '<div class="info-row"><span class="info-label">Phone</span><span>' + escHtml(patient.phone || 'N/A') + '</span></div>' +
            '</div>' +
            (patient.medical_history ? '<div class="info-row"><span class="info-label">Medical History</span><span>' + escHtml(patient.medical_history) + '</span></div>' : '') +
            (patient.allergies ? '<div class="info-row" style="color:#ef4444;"><span class="info-label">⚠ Allergies</span><span>' + escHtml(patient.allergies) + '</span></div>' : '') +
            '<h4 style="margin:1.5rem 0 1rem;">📋 Visit History (' + (visits ? visits.length : 0) + ' records)</h4>' +
            visitsHtml;

        document.getElementById('visitDetailsContent').innerHTML = content;
        openModal('visitDetailsModal');
    } catch (e) { alert('Error loading patient history.'); console.error(e); }
}

// Recent Visits (Doctor view)
window.loadRecentVisits = async function () {
    try {
        const { data: visits, error } = await supabase.from('patient_visits')
            .select('*, patients(full_name)')
            .eq('doctor_id', currentUser.id)
            .order('visit_date', { ascending: false })
            .limit(15);
        if (error) throw error;
        const el = document.getElementById('recentVisits');
        if (!visits || visits.length === 0) { el.innerHTML = '<p class="empty-state">No visits recorded yet.</p>'; return; }
        document.getElementById('myVisitsCount').textContent = visits.length;
        el.innerHTML = buildTable(
            ['Patient', 'Date', 'Type', 'Symptoms', 'Diagnosis', 'Actions'],
            visits.map(v => [
                v.patients ? escHtml(v.patients.full_name) : 'N/A',
                new Date(v.visit_date).toLocaleDateString(),
                v.visit_type || 'consultation',
                escHtml((v.symptoms || '').substring(0, 50)) + (v.symptoms && v.symptoms.length > 50 ? '...' : ''),
                escHtml(v.diagnosis || 'N/A'),
                '<button onclick="viewPatient(\'' + v.patient_id + '\')" class="btn btn-small btn-primary">History</button>'
            ])
        );
    } catch (e) { console.error(e); }
};

// ─── Doctor Dashboard Loader ─────────────────────────────────────────────────

async function loadDoctorDashboard() {
    await Promise.all([loadPatientsList(), loadRecentVisits()]);
}

// ─── Prescriptions ───────────────────────────────────────────────────────────

function openPrescriptionModal(patientId) {
    document.getElementById('prescriptionPatientId').value = patientId;
    document.getElementById('medicationsList').innerHTML = buildMedicationItem();
    openModal('prescriptionModal');
}

function buildMedicationItem() {
    return '<div class="medication-item">' +
        '<div class="form-grid">' +
        '<div class="form-group"><label>Medication</label><input type="text" class="medication-name" placeholder="Drug name" required></div>' +
        '<div class="form-group"><label>Dosage</label><input type="text" class="medication-dosage" placeholder="500mg" required></div>' +
        '<div class="form-group"><label>Frequency</label><input type="text" class="medication-frequency" placeholder="3x daily" required></div>' +
        '<div class="form-group"><label>Duration</label><input type="text" class="medication-duration" placeholder="7 days" required></div>' +
        '</div><button type="button" class="btn btn-danger btn-small remove-medication">Remove</button></div>';
}

document.getElementById('addMedication').addEventListener('click', function () {
    document.getElementById('medicationsList').insertAdjacentHTML('beforeend', buildMedicationItem());
});

document.addEventListener('click', function (e) {
    if (e.target.classList.contains('remove-medication')) {
        e.target.closest('.medication-item').remove();
    }
});

document.getElementById('prescriptionForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const patientId = document.getElementById('prescriptionPatientId').value;
    const medications = [];
    document.querySelectorAll('.medication-item').forEach(item => {
        const name = item.querySelector('.medication-name').value;
        const dosage = item.querySelector('.medication-dosage').value;
        const frequency = item.querySelector('.medication-frequency').value;
        const duration = item.querySelector('.medication-duration').value;
        if (name) medications.push({ name, dosage, frequency, duration });
    });
    if (!medications.length) { alert('Add at least one medication.'); return; }
    try {
        const { error } = await supabase.from('prescriptions').insert([{
            patient_id: patientId, doctor_id: currentUser.id, medications,
            instructions: document.getElementById('prescriptionInstructions').value || null,
        }]);
        if (error) throw error;
        alert('Prescription saved!');
        closeModal('prescriptionModal');
    } catch (err) { alert('Error: ' + err.message); }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildTable(headers, rows) {
    return '<div class="data-table"><table><thead><tr>' +
        headers.map(h => '<th>' + h + '</th>').join('') +
        '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') +
        '</tbody></table></div>';
}

function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function openModal(id) { document.getElementById(id).style.display = 'block'; }
function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
}

// expose for inline `onclick` handlers when this file is loaded as a module
window.closeModal = closeModal;

// Close modals on outside click
window.addEventListener('click', function (e) {
    if (e.target.classList.contains('modal')) {
        e.target.style.display = 'none';
    }
});

// Close modal X buttons
document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', function () {
        const modal = btn.closest('.modal');
        if (modal) modal.style.display = 'none';
    });
});

// Logout
document.getElementById('logoutBtn').addEventListener('click', async function (e) {
    e.preventDefault();
    await supabase.auth.signOut();
    window.location.href = 'login.html';
});

// Boot
loadUserProfile();

