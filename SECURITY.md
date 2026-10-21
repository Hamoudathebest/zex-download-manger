# Security policy

## Supported versions

Only the latest tagged release (`v0.1.0` and later) receives security
fixes. Phase 1 builds from `main` are development builds: they are
unsigned, and they should not be treated as hardened releases.

## Reporting a vulnerability

If you find a vulnerability, please report it privately rather than
opening a public issue: use GitHub's "Report a vulnerability" /
private vulnerability reporting on the repository, or contact the
maintainers through the repository's issue tracker asking for a
private channel. Include:

- what the issue is, and where in the code it lives;
- steps to reproduce it, on loopback or with a local test server
  where possible;
- the impact you believe it has.

Do not include credentials, tokens, cookies, or personal data in a
report. A report that needs a secret to reproduce it is not a usable
report — describe the shape of the problem instead.

We will acknowledge a report, fix it or explain why it is not a
vulnerability, and credit the reporter in the release notes unless
they ask not to be credited.

## Scope

In scope:

- The download engine's handling of URLs, redirects, filenames,
  checkpoint files, and downloaded content.
- The browser extension's permissions, Native Messaging host
  validation, and per-site activation.
- The workflows' handling of artefacts, checksums, and secrets
  (which must never be printed, echoed, or committed).
- Path traversal, redirect abuse, and destination validation.

Out of scope:

- The security of the websites a user chooses to download from.
- DRM-protected, encrypted, or otherwise access-controlled content:
  this project does not circumvent those controls, and reports
  asking it to do so will not be acted on.
- Social engineering of users, and the security of a user's own
  GitHub account or signing credentials.

## What this project deliberately does not do

- It does not extract, store, or transmit browser cookies,
  passwords, session tokens, or other credentials.
- It does not silently capture downloads: the extension only
  forwards a link the user explicitly chose.
- It does not distribute signed builds until a signing credential
  is supplied through GitHub Secrets. Until then every artefact is
  labelled UNSIGNED, and users should expect a Windows
  SmartScreen / unknown-publisher warning. That warning is the
  honest behaviour for an unsigned build, not a bug to hide.
