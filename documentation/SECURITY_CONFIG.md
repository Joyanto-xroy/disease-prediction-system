# Security Configuration

## Admin Registration Code

**CRITICAL: Change this immediately for production!**

### Current Setup
- Default admin registration code: `ADMIN_SECRET_2026`
- Location: `auth.js` line ~175

### How to Change

1. **In Development/Testing:**
   - Edit `auth.js`
   - Find: `const ADMIN_REGISTRATION_CODE = 'ADMIN_SECRET_2026';`
   - Change to a strong, unique code
   - Example: `ADMIN_REGISTRATION_CODE = 'SecureAdminCode@2026#Hospital'`

2. **For Production:**
   - Use environment variables instead (recommended)
   - Add to your hosting provider's environment variables: `ADMIN_REGISTRATION_CODE`
   - Update `auth.js` to read from environment:
     ```javascript
     const ADMIN_REGISTRATION_CODE = process.env.ADMIN_REGISTRATION_CODE || 'ADMIN_SECRET_2026';
     ```

### Security Best Practices

- ✅ Use strong, unique codes (min 12 characters)
- ✅ Change code after each admin is registered
- ✅ Never share code in emails or chat
- ✅ Never commit real codes to version control
- ✅ Use different codes for different admins if possible
- ✅ Log admin registrations for audit trail

### Doctor Approval Fix

When admin approves a doctor:
1. The `admin_verify_doctor` RPC updates `profiles.verification_status = 'verified'`
2. It also updates `auth.users.raw_user_meta_data` with new verification_status
3. Doctor can now log in - session refresh will fetch the updated metadata
4. Doctor gains full access to the dashboard

### Checking What Works

- ✅ Admin registration now requires a code (protected)
- ✅ Doctor login now refreshes session to get latest metadata after approval
- ✅ Doctors can log in immediately after admin approval
- ✅ License display shows "View License" when file exists in storage
