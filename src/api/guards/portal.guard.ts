import { configService } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { UnauthorizedException } from '@exceptions';
import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

const logger = new Logger('PORTAL_GUARD');

export interface PortalUserPayload {
  userId: string;
  email: string;
  name: string;
}

export function getJwtSecret(): string {
  const envSecret = process.env.JWT_SECRET;
  if (envSecret && envSecret.trim().length > 0) {
    return envSecret;
  }
  // Fallback to instance master apikey or fixed salt
  const globalApiKey = configService.get<any>('AUTHENTICATION')?.API_KEY?.KEY;
  return globalApiKey || 'evolution-jwt-secret-key-default-salt-2026';
}

export async function portalAuthGuard(req: Request, _: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization || (req.headers['x-access-token'] as string);
    let token = '';

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (authHeader) {
      token = authHeader;
    }

    if (!token) {
      throw new UnauthorizedException('Authentication token is required');
    }

    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret) as PortalUserPayload;

    if (!decoded || !decoded.userId) {
      throw new UnauthorizedException('Invalid or expired authentication token');
    }

    (req as any).portalUser = decoded;
    return next();
  } catch (error) {
    logger.error(`Portal auth failed: ${error?.message || error}`);
    throw new UnauthorizedException('Invalid or expired authentication token');
  }
}
