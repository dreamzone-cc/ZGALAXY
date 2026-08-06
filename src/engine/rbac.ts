import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../services/userService';

// Whitelist of valid roles accepted at runtime
export const VALID_ROLES: UserRole[] = ['ADMIN', 'OPERATOR', 'READ_ONLY'];

export function roleIsValid(role: string | undefined): role is UserRole {
  return VALID_ROLES.includes(role as UserRole);
}

// Require that the authenticated principal holds at least the given role.
// Wire up by importing and adding `, auth.requireRole('ADMIN')` before the handler.
export function requireRole(...allowed: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = (req as any).userRole as UserRole | undefined;
    if (!role) {
      return res.status(403).json({ success: false, error: 'Forbidden: authentication required to determine role.' });
    }
    if (!allowed.includes(role)) {
      return res.status(403).json({
        success: false,
        error: `Forbidden: requires role [${allowed.join('/')}]. Current role [${role}].`,
      });
    }
    next();
  };
}