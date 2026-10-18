import { RouterBroker } from '@api/abstract/abstract.router';
import { portalAuthGuard, PortalUserPayload } from '@api/guards/portal.guard';
import { userController } from '@api/server.module';
import { ROOT_DIR } from '@config/path.config';
import express, { Request, Response, Router } from 'express';
import path from 'path';

import { HttpStatus } from './index.router';

export class PortalRouter extends RouterBroker {
  public readonly router: Router = Router();

  constructor() {
    super();

    // ----------------------------------------------------
    // User Portal Authentication & Instance APIs
    // ----------------------------------------------------

    // User Login
    this.router.post('/api/login', async (req: Request, res: Response) => {
      const { email, password } = req.body;
      const response = await userController.login({ email, password });
      return res.status(HttpStatus.OK).json(response);
    });

    // Get current user profile & instance overview
    this.router.get('/api/me', portalAuthGuard, async (req: Request, res: Response) => {
      const portalUser = (req as any).portalUser as PortalUserPayload;
      const response = await userController.getMe(portalUser.userId);
      return res.status(HttpStatus.OK).json(response);
    });

    // Update current user profile (name/password only; email is locked)
    this.router.put('/api/profile', portalAuthGuard, async (req: Request, res: Response) => {
      const portalUser = (req as any).portalUser as PortalUserPayload;
      const { name, password } = req.body;
      const response = await userController.updateUser(portalUser.userId, { name, password });
      return res.status(HttpStatus.OK).json(response);
    });

    // Create 1 Allowed Instance for this user
    this.router.post('/api/instance/create', portalAuthGuard, async (req: Request, res: Response) => {
      const portalUser = (req as any).portalUser as PortalUserPayload;
      const instanceData = req.body;
      const response = await userController.createUserInstance(portalUser.userId, instanceData);
      return res.status(HttpStatus.CREATED).json(response);
    });

    // Get live status & QR / Pairing Code of user's instance
    this.router.get('/api/instance/status', portalAuthGuard, async (req: Request, res: Response) => {
      const portalUser = (req as any).portalUser as PortalUserPayload;
      const response = await userController.getUserInstanceLive(portalUser.userId);
      return res.status(HttpStatus.OK).json(response || { status: 'none', message: 'No instance created' });
    });

    // Connect to WhatsApp (optionally requesting pairing code with number)
    this.router.post('/api/instance/connect', portalAuthGuard, async (req: Request, res: Response) => {
      const portalUser = (req as any).portalUser as PortalUserPayload;
      const { number } = req.body || {};
      const response = await userController.connectUserInstance(portalUser.userId, number);
      return res.status(HttpStatus.OK).json(response);
    });

    // Restart user's instance
    this.router.post('/api/instance/restart', portalAuthGuard, async (req: Request, res: Response) => {
      const portalUser = (req as any).portalUser as PortalUserPayload;
      const response = await userController.restartUserInstance(portalUser.userId);
      return res.status(HttpStatus.OK).json(response);
    });

    // Logout user's WhatsApp session
    this.router.delete('/api/instance/logout', portalAuthGuard, async (req: Request, res: Response) => {
      const portalUser = (req as any).portalUser as PortalUserPayload;
      const response = await userController.logoutUserInstance(portalUser.userId);
      return res.status(HttpStatus.OK).json(response);
    });

    // Delete user's instance
    this.router.delete('/api/instance/delete', portalAuthGuard, async (req: Request, res: Response) => {
      const portalUser = (req as any).portalUser as PortalUserPayload;
      const response = await userController.deleteUserInstance(portalUser.userId);
      return res.status(HttpStatus.OK).json(response);
    });

    // Send WhatsApp Text Message (with auto +91 Indian format)
    this.router.post('/api/message/send', portalAuthGuard, async (req: Request, res: Response) => {
      const portalUser = (req as any).portalUser as PortalUserPayload;
      const { number, text } = req.body || {};
      const response = await userController.sendUserMessage(portalUser.userId, { number, text });
      return res.status(HttpStatus.OK).json(response);
    });

    // ----------------------------------------------------
    // Serve Portal Web UI
    // ----------------------------------------------------
    const portalStaticPath = path.join(ROOT_DIR, 'public', 'portal');
    this.router.use('/', express.static(portalStaticPath));

    this.router.get('/', (_req: Request, res: Response) => {
      res.sendFile(path.join(portalStaticPath, 'login.html'));
    });

    this.router.get('/login', (_req: Request, res: Response) => {
      res.sendFile(path.join(portalStaticPath, 'login.html'));
    });

    this.router.get('/dashboard', (_req: Request, res: Response) => {
      res.sendFile(path.join(portalStaticPath, 'dashboard.html'));
    });

    this.router.get('/admin', (_req: Request, res: Response) => {
      res.sendFile(path.join(portalStaticPath, 'admin.html'));
    });
  }
}
