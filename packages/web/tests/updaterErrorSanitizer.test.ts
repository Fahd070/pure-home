// Regression tests for the updater error sanitizer (audit follow-up: the
// persisted electron-log call used to receive the raw Error object directly
// -- `log.error("[updater] error:", err)` -- which could serialize its full
// stack, including local filesystem paths or a download URL with a signed/
// auth query parameter, into the log file). These tests import the module
// directly (it has no "electron" dependency) rather than executing the
// Electron main process.
import { describe, it, expect } from 'vitest';
import {
  sanitizeUpdaterError,
  sanitizeUpdaterErrorDetails,
  formatUpdaterErrorLogLine,
} from '../../unified-app/electron/main/updaterErrorSanitizer';

describe('sanitizeUpdaterErrorDetails / sanitizeUpdaterError', () => {
  it('strips a Windows local filesystem path from the message', () => {
    const err = new Error('ENOENT: no such file C:\\Users\\someone\\AppData\\Local\\pure-home-updater\\pending\\update.exe');
    const { message } = sanitizeUpdaterErrorDetails(err);
    expect(message).not.toMatch(/C:\\Users/);
    expect(message).toContain('[local path]');
  });

  it('strips a token/key/password/secret/auth query parameter from a download URL in the message', () => {
    const err = new Error('request to https://example.com/asset?token=super-secret-value&other=1 failed');
    const { message } = sanitizeUpdaterErrorDetails(err);
    expect(message).not.toContain('super-secret-value');
    expect(message).toContain('token=[redacted]');
    expect(message).toContain('other=1'); // unrelated params are left alone
  });

  it('preserves a safe error name and code for troubleshooting', () => {
    const err: any = new Error('net::ERR_INTERNET_DISCONNECTED');
    err.name = 'HttpError';
    err.code = 'ERR_INTERNET_DISCONNECTED';
    const details = sanitizeUpdaterErrorDetails(err);
    expect(details.name).toBe('HttpError');
    expect(details.code).toBe('ERR_INTERNET_DISCONNECTED');
    expect(details.message).toContain('ERR_INTERNET_DISCONNECTED');
  });

  it('never reads or exposes the stack trace', () => {
    const err = new Error('boom');
    err.stack = 'Error: boom\n    at C:\\Users\\someone\\secret\\place\\file.js:1:1';
    const details = sanitizeUpdaterErrorDetails(err);
    expect(details.message).not.toContain('secret\\place');
    expect(JSON.stringify(details)).not.toContain('at C:\\Users');
  });

  it('handles a non-Error thrown value safely', () => {
    expect(sanitizeUpdaterError('plain string failure')).toBe('plain string failure');
    expect(sanitizeUpdaterError(undefined)).toBe('Unknown error');
  });

  it('truncates an excessively long message', () => {
    const err = new Error('x'.repeat(5000));
    expect(sanitizeUpdaterError(err).length).toBeLessThanOrEqual(300);
  });

  it('strips an access_token query parameter', () => {
    const err = new Error('request to https://example.com/asset?access_token=super-secret-value&other=1 failed');
    const { message } = sanitizeUpdaterErrorDetails(err);
    expect(message).not.toContain('super-secret-value');
    expect(message).toContain('access_token=[redacted]');
    expect(message).toContain('other=1');
  });

  it('strips a signature query parameter from a signed/private download URL', () => {
    const err = new Error('download failed for https://cdn.example.com/file.exe?signature=abcdef123456&expires=1');
    const { message } = sanitizeUpdaterErrorDetails(err);
    expect(message).not.toContain('abcdef123456');
    expect(message).toContain('signature=[redacted]');
    expect(message).toContain('expires=1');
  });

  it('strips an X-Amz-Signature query parameter from an S3 pre-signed URL', () => {
    const err = new Error(
      'GET https://bucket.s3.amazonaws.com/setup.exe?X-Amz-Credential=AKIAEXAMPLE%2F20260101&X-Amz-Signature=deadbeef1234 -> 403'
    );
    const { message } = sanitizeUpdaterErrorDetails(err);
    expect(message).not.toContain('deadbeef1234');
    expect(message).not.toContain('AKIAEXAMPLE');
    expect(message).toMatch(/X-Amz-Signature=\[redacted\]/i);
    expect(message).toMatch(/X-Amz-Credential=\[redacted\]/i);
  });

  it('strips a credential query parameter', () => {
    const err = new Error('request to https://example.com/asset?credential=service-account-secret&region=us-east-1 failed');
    const { message } = sanitizeUpdaterErrorDetails(err);
    expect(message).not.toContain('service-account-secret');
    expect(message).toContain('credential=[redacted]');
    expect(message).toContain('region=us-east-1'); // unrelated params still left alone
  });

  it('does not redact an unrelated parameter that merely contains a sensitive word as a substring (e.g. "apikey")', () => {
    const err = new Error('request to https://example.com/asset?apikey=not-an-exact-match&filename=setup.exe failed');
    const { message } = sanitizeUpdaterErrorDetails(err);
    // "apikey" is not one of the exact sensitive parameter names, so it is
    // harmless diagnostic information and must be left alone.
    expect(message).toContain('apikey=not-an-exact-match');
    expect(message).toContain('filename=setup.exe');
  });
});

describe('formatUpdaterErrorLogLine', () => {
  it('produces a single sanitized line with context, name, code, and message -- never the raw error object', () => {
    const err: any = new Error('download failed for https://example.com/file?token=abc123 at C:\\Users\\someone\\path');
    err.name = 'HttpError';
    err.code = 'ERR_BAD_RESPONSE';
    const line = formatUpdaterErrorLogLine('update check/download', err);

    expect(line).toContain('[updater] update check/download failed');
    expect(line).toContain('name=HttpError');
    expect(line).toContain('code=ERR_BAD_RESPONSE');
    expect(line).not.toContain('abc123');
    expect(line).not.toContain('C:\\Users\\someone');
    expect(typeof line).toBe('string'); // a single formatted string, not the error object itself
  });

  it('falls back to "unknown"/"none" when name/code are not available', () => {
    const line = formatUpdaterErrorLogLine('checkForUpdates()', 'network unreachable');
    expect(line).toContain('name=unknown');
    expect(line).toContain('code=none');
    expect(line).toContain('message=network unreachable');
  });
});
