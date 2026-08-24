import type { Request } from 'express';
import {
  DESKTOP_SESSION_HEADER,
  verifyDesktopSessionProof,
} from '../config/desktop_bootstrap';
import { isLoopbackAddress } from '../config/local_identity';
import type { ToolContext } from '../tools/types';

export type HttpToolSecurityContext = Pick<
  ToolContext,
  'authenticated' | 'authRole' | 'orgRole' | 'localExecution' | 'executionBoundary'
> & { desktopProofPresented: boolean };

/**
 * Project an authenticated HTTP request into the same execution boundary used
 * by Socket.IO. Loopback alone grants nothing: trusted-local authority requires
 * a native session proof bound to the authenticated JWT subject.
 */
export function buildHttpToolSecurityContext(req: Request): HttpToolSecurityContext {
  const userId = String(req.user?.uid || '').trim();
  const header = req.headers[DESKTOP_SESSION_HEADER];
  const presentedProof = Array.isArray(header) ? String(header[0] || '').trim() : String(header || '').trim();
  const authenticated = Boolean(userId);
  const localExecution = authenticated
    && isLoopbackAddress(req.socket?.remoteAddress)
    && verifyDesktopSessionProof(presentedProof, userId);

  return {
    authenticated,
    authRole: String(req.user?.role || 'user'),
    orgRole: req.user?.orgRole || undefined,
    localExecution,
    executionBoundary: localExecution ? 'trusted_local' : 'remote_restricted',
    desktopProofPresented: Boolean(presentedProof),
  };
}
