import { setPassword } from './settings.js';

const pw = process.argv[2];
if (!pw || pw.length < 8) {
  console.error('Usage: npm run reset-password -- <new password (min 8 chars)>');
  process.exit(1);
}
setPassword(pw);
console.log('Master password updated. Restart is not required.');
