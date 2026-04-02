import { supabase } from './supabase-config.js';

let currentUser = null;
let currentProfile = null;

// ─── Auth ──────────────────────────────────────────────────────────────────

async function checkAuth() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = 'src/view/login.html'; return null; }
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
        console.log('Loading patients... Role:', currentProfile?.role, 'User ID:', currentUser?.id);
        
        let query = supabase.from('patients').select('*, profiles(full_name)').order('created_at', { ascending: false });
        
        if (currentProfile && currentProfile.role === 'doctor' && currentUser && currentUser.id) {
            console.log('Filtering patients for doctor:', currentUser.id);
            query = query.eq('created_by', currentUser.id);
        }
        
        const { data, error } = await query;
        
        if (error) {
            console.error('Patient query error:', error);
            throw error;
        }
        
        console.log('Loaded patients:', data ? data.length : 0, 'Total records:', data);
        
        const isAdmin = currentProfile && currentProfile.role === 'admin';
        const el = document.getElementById(isAdmin ? 'adminPatientsList' : 'doctorPatientsList');
        if (!data || data.length === 0) { 
            if (el) el.innerHTML = '<p class="empty-state">No patients found. Add a new patient to get started.</p>'; 
            if (!isAdmin) {
                document.getElementById('myPatientsCount').textContent = '0';
            }
            return; 
        }

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
                    '<button onclick="prescribeMedication(\'' + p.id + '\')" class="btn btn-small btn-warning">Rx</button> ' +
                    '<button onclick="openReportModal(\'' + p.id + '\')" class="btn btn-small btn-secondary">Report</button> ' : '') +
                (isAdmin ? '<button onclick="deletePatient(\'' + p.id + '\')" class="btn btn-small btn-danger">Delete</button>' : '')
            ])
        );

        // Update count badges
        if (currentProfile && currentProfile.role === 'doctor') {
            document.getElementById('myPatientsCount').textContent = data.length;
        }
    } catch (e) { 
        console.error('Patients list error:', e);
        const el = document.getElementById('patientsList');
        if (el) el.innerHTML = '<p class="empty-state" style="color:#ef4444;">⚠️ Error loading patients: ' + e.message + '</p>';
    }
};

window.openPatientModal = function () { openPatientModal(); };
window.editPatient = function (id) { openPatientModal(id); };
window.viewPatient = function (id) { viewPatientHistory(id); };
window.addVisit = function (id) { openVisitModal(id); };
window.prescribeMedication = function (id) { openPrescriptionModal(id); };
window.openReportModal = function (id) { openReportModal(id); };

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
    const fullName = document.getElementById('patientName').value.trim();
    const dob = document.getElementById('patientDob').value;
    const gender = document.getElementById('patientGender').value;
    
    // Validate required fields
    if (!fullName) { alert('Patient name is required'); return; }
    if (!dob) { alert('Date of birth is required'); return; }
    if (!gender) { alert('Gender is required'); return; }
    
    const data = {
        full_name: fullName,
        date_of_birth: dob,
        gender: gender,
        phone: document.getElementById('patientPhone').value.trim() || null,
        email: document.getElementById('patientEmail').value.trim() || null,
        address: document.getElementById('patientAddress').value.trim() || null,
        emergency_contact_name: document.getElementById('emergencyContactName').value.trim() || null,
        emergency_contact_phone: document.getElementById('emergencyContactPhone').value.trim() || null,
        medical_history: document.getElementById('medicalHistory').value.trim() || null,
        allergies: document.getElementById('allergies').value.trim() || null,
        current_medications: document.getElementById('currentMedications').value.trim() || null,
        blood_group: (document.getElementById('patientBloodGroup').value || '').trim() || null,
    };
    
    try {
        if (id) {
            // Update existing patient
            const { error } = await supabase.from('patients').update(data).eq('id', id).select();
            if (error) throw error;
            alert('Patient updated successfully!');
        } else {
            // Insert new patient - MUST include created_by
            if (!currentUser || !currentUser.id) {
                alert('Error: User not authenticated. Please log in again.');
                return;
            }
            data.created_by = currentUser.id;
            const { error, data: insertedData } = await supabase.from('patients').insert([data]).select();
            if (error) {
                console.error('Patient insert error:', error);
                throw new Error('Failed to add patient: ' + (error.message || error));
            }
            if (!insertedData || insertedData.length === 0) {
                throw new Error('Patient was not created (no response from server)');
            }
            alert('Patient added successfully!');
        }
        closeModal('patientModal');
        document.getElementById('patientForm').reset();
        loadPatientsList();
        if (currentProfile && currentProfile.role === 'admin') loadAdminStats();
    } catch (err) {
        console.error('Patient form error:', err);
        alert('Error saving patient: ' + (err.message || err.toString()));
    }
});

// ─── Visit Management ───────────────────────────────────────────────────────

function openVisitModal(patientId, visitId = null) {
    document.getElementById('visitPatientId').value = patientId;
    document.getElementById('visitId').value = visitId || '';
    document.getElementById('visitForm').reset();
    document.getElementById('visitDate').value = new Date().toISOString().slice(0, 16);
    document.getElementById('visitModalTitle').textContent = visitId ? 'Edit Visit Record' : 'Record Patient Visit';
    updatePredictionUi();
    openModal('visitModal');
}

document.getElementById('visitForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const symptoms = document.getElementById('visitSymptoms').value.trim();
    
    if (!symptoms) { alert('Please enter symptoms'); return; }
    
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
        symptoms: symptoms,
        test_results: document.getElementById('testResults').value.trim() || null,
        diagnosis: document.getElementById('visitDiagnosis').value.trim() || null,
        notes: document.getElementById('visitNotes').value.trim() || null,
        vitals: vitals,
    };
    try {
        const visitId = document.getElementById('visitId').value;
        if (visitId) {
            const { error } = await supabase.from('patient_visits').update(visitData).eq('id', visitId).select();
            if (error) throw error;
            alert('Visit record updated!');
        } else {
            const { error, data: insertedData } = await supabase.from('patient_visits').insert([visitData]).select();
            if (error) throw error;
            if (!insertedData || insertedData.length === 0) throw new Error('Visit was not created');
            alert('Visit recorded!');
        }
        closeModal('visitModal');
        document.getElementById('visitForm').reset();
        loadRecentVisits();
        if (currentProfile && currentProfile.role === 'admin') loadAdminStats();
    } catch (err) {
        console.error('Visit form error:', err);
        alert('Error saving visit: ' + (err.message || err.toString()));
    }
});

// Patient History Viewer
async function viewPatientHistory(patientId) {
    try {
        const { data: patient } = await supabase.from('patients').select('*').eq('id', patientId).single();
        const { data: visits } = await supabase.from('patient_visits').select('*, profiles(full_name)').eq('patient_id', patientId).order('visit_date', { ascending: false });
        const { data: prescriptions } = await supabase.from('prescriptions').select('*, profiles(full_name)').eq('patient_id', patientId).order('created_at', { ascending: false });
        const { data: reports } = await supabase.from('reports').select('*, profiles(full_name)').eq('patient_id', patientId).order('created_at', { ascending: false });

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

        let prescriptionsHtml = '<p style="color:#94a3b8;">No prescription records found.</p>';
        if (prescriptions && prescriptions.length > 0) {
            prescriptionsHtml = prescriptions.map(p => {
                const doctorName = p.profiles ? escHtml(p.profiles.full_name) : 'Unknown';
                let medsHtml = '<ul>';
                try {
                    const meds = typeof p.medications === 'string' ? JSON.parse(p.medications) : p.medications;
                    if (Array.isArray(meds)) {
                        meds.forEach(m => {
                            medsHtml += `<li><strong>${escHtml(m.name)}</strong>: ${escHtml(m.dosage)}, ${escHtml(m.frequency)} for ${escHtml(m.duration)}</li>`;
                        });
                    }
                } catch(e) {}
                medsHtml += '</ul>';
                
                return '<div class="visit-card">' +
                    '<div class="visit-card-header">' +
                    '<strong>' + new Date(p.created_at).toLocaleString() + '</strong>' +
                    '<span class="visit-type-badge" style="background:#fef3c7;color:#d97706;border-color:#fde68a;">Prescription</span>' +
                    '</div>' +
                    '<div class="info-row"><span class="info-label">Doctor</span><span>' + doctorName + '</span></div>' +
                    medsHtml +
                    (p.instructions ? '<div class="info-row"><span class="info-label">Instructions</span><span>' + escHtml(p.instructions) + '</span></div>' : '') +
                    '</div>';
            }).join('');
        }
        content += '<h4 style="margin:1.5rem 0 1rem;">💊 Prescriptions (' + (prescriptions ? prescriptions.length : 0) + ' records)</h4>' + prescriptionsHtml;

        let reportsHtml = '<p style="color:#94a3b8;">No medical reports found.</p>';
        if (reports && reports.length > 0) {
            reportsHtml = reports.map(r => {
                const doctorName = r.profiles ? escHtml(r.profiles.full_name) : 'Unknown';
                return '<div class="visit-card">' +
                    '<div class="visit-card-header">' +
                    '<strong>' + new Date(r.created_at).toLocaleString() + '</strong>' +
                    '<span class="visit-type-badge" style="background:#e0e7ff;color:#4f46e5;border-color:#c7d2fe;">' + escHtml(r.report_type) + '</span>' +
                    '</div>' +
                    '<div class="info-row"><span class="info-label">Doctor</span><span>' + doctorName + '</span></div>' +
                    '<div class="info-row"><span class="info-label">Title</span><strong>' + escHtml(r.title) + '</strong></div>' +
                    '<div class="info-row"><span class="info-label">Content</span><span style="white-space:pre-wrap;">' + escHtml(r.content) + '</span></div>' +
                    '</div>';
            }).join('');
        }
        content += '<h4 style="margin:1.5rem 0 1rem;">📄 Medical Reports (' + (reports ? reports.length : 0) + ' records)</h4>' + reportsHtml;

        document.getElementById('visitDetailsContent').innerHTML = content;
        openModal('visitDetailsModal');
    } catch (e) { alert('Error loading patient history.'); console.error(e); }
}

// Recent Visits (Doctor view)
window.loadRecentVisits = async function () {
    try {
        if (!currentUser || !currentUser.id) {
            console.warn('No current user for recent visits');
            return;
        }
        
        console.log('Loading recent visits for doctor:', currentUser.id);
        
        const { data: visits, error } = await supabase.from('patient_visits')
            .select('*, patients(full_name)')
            .eq('doctor_id', currentUser.id)
            .order('visit_date', { ascending: false })
            .limit(15);
            
        if (error) {
            console.error('Recent visits query error:', error);
            throw error;
        }
        
        console.log('Loaded recent visits:', visits ? visits.length : 0);
        
        const el = document.getElementById('recentVisits');
        if (!el) return;
        
        if (!visits || visits.length === 0) { 
            el.innerHTML = '<p class="empty-state">No visits recorded yet. Start by adding your first patient visit.</p>'; 
            if (document.getElementById('myVisitsCount')) {
                document.getElementById('myVisitsCount').textContent = '0';
            }
            return; 
        }
        
        if (document.getElementById('myVisitsCount')) {
            document.getElementById('myVisitsCount').textContent = visits.length;
        }
        
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
    } catch (e) { 
        console.error('Recent visits error:', e);
        const el = document.getElementById('recentVisits');
        if (el) el.innerHTML = '<p class="empty-state" style="color:#ef4444;">⚠️ Error loading visits: ' + e.message + '</p>';
    }
};

// ─── Doctor Dashboard Loader ─────────────────────────────────────────────────

async function loadDoctorDashboard() {
    // Check if ML service is available and show banner
    const mlServiceAvailable = await checkPredictionServiceHealth();
    const mlInfoDiv = document.getElementById('mlServiceInfo');
    if (mlInfoDiv) {
        mlInfoDiv.style.display = mlServiceAvailable ? 'none' : 'block';
    }

    // Update the prediction UI based on doctor specialization
    updatePredictionUi();
    
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

// ─── Reports ─────────────────────────────────────────────────────────────────

function openReportModal(patientId) {
    document.getElementById('reportPatientId').value = patientId;
    document.getElementById('reportForm').reset();
    openModal('reportModal');
}

document.getElementById('reportForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const patientId = document.getElementById('reportPatientId').value;
    const reportType = document.getElementById('reportType').value;
    const title = document.getElementById('reportTitle').value.trim();
    const content = document.getElementById('reportContent').value.trim();

    if (!title || !content) {
        alert('Please provide both title and content for the report.');
        return;
    }

    try {
        const { error } = await supabase.from('reports').insert([{
            patient_id: patientId,
            doctor_id: currentUser.id,
            report_type: reportType,
            title: title,
            content: content
        }]);

        if (error) throw error;
        alert('Report generated and saved successfully!');
        closeModal('reportModal');
    } catch (err) {
        alert('Error saving report: ' + err.message);
    }
});

// ─── Disease Prediction Engine (ML-based via Python API) ──────────────────

// Configuration for the prediction service
const PREDICTION_SERVICE_URL = 'http://localhost:5001';

// Check if prediction service is available with retry
async function checkPredictionServiceHealth() {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);

            const response = await fetch(`${PREDICTION_SERVICE_URL}/health`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                },
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            if (response.ok) {
                return true;
            }
        } catch (e) {
            console.log(`ML Service health check attempt ${attempt} failed:`, e.message);
        }

        // Wait before retrying
        if (attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    return false;
}

function isCardiologyDoctor() {
    return !!(currentProfile && currentProfile.specialization && currentProfile.specialization.toLowerCase().includes('cardio'));
}

function updatePredictionUi() {
    const btn = document.getElementById('predictHeartDiseaseBtn');
    const notice = document.getElementById('predictionCardiologyNotice');
    if (!btn || !notice) return;

    if (isCardiologyDoctor()) {
        btn.disabled = false;
        notice.textContent = '🔎 Enter patient symptoms and vitals, then click the button to get a cardiology risk prediction.';
    } else {
        btn.disabled = true;
        notice.textContent = 'Heart disease risk prediction is available only for cardiology specialists. Update your profile specialization to "Cardiology" to enable this feature.';
    }
}

function calculateAgeFromDOB(dob) {
    if (!dob) return null;
    const date = new Date(dob);
    if (Number.isNaN(date.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - date.getFullYear();
    const m = now.getMonth() - date.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < date.getDate())) {
        age -= 1;
    }
    return age;
}

function parseNumberFromText(text, regex, defaultValue = null) {
    if (!text) return defaultValue;
    const match = text.match(regex);
    if (!match) return defaultValue;
    const num = parseFloat(match[1]);
    return Number.isFinite(num) ? num : defaultValue;
}

window.predictDiseaseForVisit = async function () {
    const resultDiv = document.getElementById('predictionResult');
    if (!resultDiv) return;

    // Only cardiology specialists can use the ML heart disease predictor
    if (!isCardiologyDoctor()) {
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = '<div style="background:#fffbeb;border-left:4px solid #f97316;padding:1rem;border-radius:4px;color:#92400e;"><strong>ℹ️ Module restricted</strong><br/>Heart disease risk prediction is enabled for cardiology doctors only.</div>';
        return;
    }

    const symptoms = document.getElementById('visitSymptoms').value.trim();
    const testResults = document.getElementById('testResults').value.trim();
    const diagnosis = document.getElementById('visitDiagnosis').value.trim();

    if (!symptoms) {
        alert('Please enter symptoms first');
        return;
    }

    resultDiv.innerHTML = '<div style="background:#e0e7ff;border-left:4px solid #6366f1;padding:1rem;border-radius:4px;color:#312e81;">⏳ Analyzing symptoms and vitals with ML model...</div>';
    resultDiv.style.display = 'block';

    try {
        // Check if service is available
        const serviceHealthy = await checkPredictionServiceHealth();
        if (!serviceHealthy) {
            resultDiv.innerHTML = '<div style="background:#fee2e2;border-left:4px solid #ef4444;padding:1rem;border-radius:4px;color:#7f1d1d;"><strong>⚠️ ML Service Unavailable</strong><br/>Start the Python disease prediction service:<br/><code style="background:#fff;padding:0.25rem;border-radius:2px;">python disease_prediction_service.py</code></div>';
            return;
        }

        // Try to gather patient demographics for more accurate prediction
        const patientId = document.getElementById('visitPatientId').value;
        let patientData = null;
        if (patientId) {
            try {
                const { data, error } = await supabase.from('patients').select('date_of_birth, gender').eq('id', patientId).single();
                if (!error) patientData = data;
            } catch (err) {
                // ignore - prediction will proceed with defaults
            }
        }

        const age = calculateAgeFromDOB(patientData?.date_of_birth) || 55;
        const gender = (patientData?.gender || '').toLowerCase();
        const sex = gender === 'female' ? 0 : 1;

        const bpRaw = document.getElementById('vitalBP').value.trim();
        const trestbps = parseNumberFromText(bpRaw, /([0-9]{2,3})/, 120);
        const heartRate = parseFloat(document.getElementById('vitalHR').value);
        const thalach = Number.isFinite(heartRate) ? heartRate : 150;

        const chol = parseNumberFromText(testResults, /(?:chol(?:esterol)?[:=]?\s*)([0-9]{2,3})/i, 200);
        const glucose = parseNumberFromText(testResults, /(?:fasting\s*blood\s*sugar|fbs|glucose)[:=]?\s*([0-9]{2,3})/i, null);
        const fbs = glucose !== null ? (glucose > 120 ? 1 : 0) : 0;

        const cp = /chest pain|angina|tightness/i.test(symptoms) ? 1 : 0;
        const restecg = /ecg|ekg|st[- ]?elevation|t wave/i.test(testResults) ? 1 : 0;
        const exang = /exertion|exercise|walking|running/i.test(symptoms) ? 1 : 0;

        const payload = {
            department: 'cardiology',
            age: age,
            sex: sex,
            cp: cp,
            trestbps: trestbps,
            chol: chol,
            fbs: fbs,
            restecg: restecg,
            thalach: thalach,
            exang: exang,
            oldpeak: 0.0,
            slope: 2,
            ca: 0,
            thal: 2
        };

        const response = await fetch(`${PREDICTION_SERVICE_URL}/predict_heart_disease`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error('Prediction service error: ' + response.statusText);
        }

        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || 'Unexpected response from prediction service');
        }

        const risk = result.risk_percentage;
        const isHigh = result.has_disease_risk;

        resultDiv.innerHTML = `<div style="background:#f0fdf4;border-left:4px solid ${isHigh ? '#dc2626' : '#22c55e'};padding:1rem;border-radius:4px;color:#166534;">
            <strong>❤️ Cardiology Risk Prediction</strong>
            <div style="margin-top:0.5rem;">Estimated heart disease risk: <strong>${risk.toFixed(2)}%</strong></div>
            <div style="margin-top:0.75rem;">${escHtml(result.recommendation || '')}</div>
            <div style="margin-top:1rem;padding-top:0.75rem;border-top:1px solid #dcfce7;font-size:0.85rem;"><strong>⚠️ Disclaimer:</strong> ${escHtml(result.disclaimer)}</div>
        </div>`;
    } catch (error) {
        console.error('Prediction error:', error);
        resultDiv.innerHTML = '<div style="background:#fee2e2;border-left:4px solid #ef4444;padding:1rem;border-radius:4px;color:#7f1d1d;"><strong>❌ Prediction Error</strong><br/>' + escHtml(error.message) + '<br/><br/>Make sure the Python service is running:<br/><code style="background:#fff;padding:0.25rem;border-radius:2px;">python disease_prediction_service.py</code></div>';
    }
};

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
    window.location.href = 'src/view/login.html';
});

// Boot
loadUserProfile();

