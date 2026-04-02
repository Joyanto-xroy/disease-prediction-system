# Clinical Support System

A comprehensive web-based clinical support system built with HTML, CSS, JavaScript, and Supabase for secure data management.

## Features

### Admin Features
- Dashboard with system overview (total doctors, pending verifications, patients)
- Doctor management (verify/reject registrations, view details)
- Patient management (add, edit, view patient records)
- User and role management
- Profile management

### Doctor Features
- Secure registration with license verification
- Profile setup and management (requires admin approval)
- Patient management (add new patients, view/edit records)
- Visit recording (symptoms, diagnosis, notes, test results)
- Prescription creation with multiple medications
- Medical report generation
- Patient history viewing

### Security Features
- Role-based access control (Admin, Doctor)
- Doctor verification process before login
- Row Level Security (RLS) policies in database
- Secure file upload for licenses
- Encrypted data storage

## Database Schema

### Tables
- `profiles` - User profiles with roles and verification status
- `patients` - Patient demographic and medical information
- `patient_visits` - Medical visit records
- `prescriptions` - Medication prescriptions
- `reports` - Medical reports

## Setup Instructions

### 1. Database Setup
1. Create a new Supabase project
2. Run the migrations in order:
   - `supabase/migrations/20260304174650_create_profiles_table.sql`
   - `supabase/migrations/20260306120000_upgrade_database.sql`

### 2. Storage Setup
Create a storage bucket named `licenses` for storing doctor and clinic license files.

### 3. Environment Configuration
Update `supabase-config.js` with your Supabase project URL and anon key.

### 4. Running the Application
```bash
npm install
npm run dev
```

Or use Python's HTTP server:
```bash
python -m http.server 3000
```

## User Roles and Workflows

### Admin Registration
1. Register as admin with clinic permit ID and license
2. Automatically verified upon registration

### Doctor Registration
1. Register with doctor ID and license photo
2. Account remains unverified until admin approval
3. Cannot login until verified
4. After verification, can access full doctor features

### Doctor Workflow
1. Login (only if verified)
2. Complete profile setup if needed
3. Add/manage patients
4. Record patient visits with symptoms and diagnosis
5. Create prescriptions
6. Generate medical reports

### Admin Workflow
1. Login
2. Review pending doctor verifications
3. Approve or reject doctor registrations
4. Monitor system statistics
5. Manage patients and user roles

## Security Considerations

- All data is stored securely in Supabase with RLS policies
- File uploads are restricted to images only
- Doctors must be verified before accessing patient data
- Admins have full access to system management
- Password requirements enforced during registration

## Technologies Used

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Backend**: Supabase (PostgreSQL, Auth, Storage)
- **Styling**: Custom CSS with modern design principles
- **Security**: Supabase RLS, JWT authentication

## Future Enhancements

- Email notifications for verification status
- Advanced reporting and analytics
- Appointment scheduling system
- Integration with medical devices
- Multi-language support
- Mobile responsive improvements</content>
<parameter name="filePath">c:\Users\roy\Desktop\project\README.md