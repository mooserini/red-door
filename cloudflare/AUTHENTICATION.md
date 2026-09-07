# Browser password processing

The browser runs PBKDF2-HMAC-SHA256 with 600,000 iterations, a random per-account
16-byte salt, and a 32-byte output using native Web Crypto. The hexadecimal salt
is encoded as UTF-8 to preserve compatibility with the frozen local preview.
The shipped client checks the existing 8-character minimum and 128-byte maximum.

`POST /api/auth-params` returns the public account salt, or a fresh salt for a
new/unknown handle. This endpoint reserves no account and uses the same short
login throttle as registration and login. Handles are case insensitive.

Over same-origin HTTPS, the client submits handle, salt, and a derived password
key to registration/login. The Worker does not accept plaintext passwords.
It stores `SHA256("reddoor-login-v1:" + salt + ":" + password_key)` with a
versioned scheme prefix, not the transmitted key. Login hashes the submitted
key and checks the stored verifier in constant time. A database verifier cannot
be submitted directly to log in. Existing frozen-preview accounts are upgraded
after a successful login without changing their saves or repeating a server KDF.

The transmitted derived key is a reusable credential, like a password, and must
be protected by HTTPS and kept out of logs, URLs, and persistent browser storage.
This is client-side password stretching with a separate server verifier. It is
not OPAQUE, a challenge-response protocol, or a claim of zero-knowledge security.
A database thief can still guess passwords offline, paying the client KDF cost
for each guess. A modified client can select a weak registration key for its own
account; the server cannot prove that the client performed stretching or enforce
the original password length. No browser model/AI is involved in authentication.

The Worker remains responsible for login sessions and canonical game changes.
Secure HttpOnly SameSite=Strict cookies, same-origin JSON writes, bounded bodies,
throttling, revision checks, and exactly-once command receipts remain in place.
No email, password reset, recovery key, or account recovery endpoint is added.

The larger Workers CPU setting was removed. `hosted-verification.json` records a
successful register/move/logout/login round trip on the existing Workers Free
account. These successful requests are hosted evidence, not a guarantee of
unlimited traffic or a precise CPU-time measurement.
