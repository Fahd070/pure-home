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
