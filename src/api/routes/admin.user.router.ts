import { RouterBroker } from '@api/abstract/abstract.router';
import { userController } from '@api/server.module';
import { RequestHandler, Router } from 'express';

import { HttpStatus } from './index.router';

export class AdminUserRouter extends RouterBroker {
  public readonly router: Router = Router();

  constructor(...guards: RequestHandler[]) {
    super();

    this.router
      // Verify Master Admin Password / API Key
      .post('/verify', async (req, res) => {
        const key = req.headers['apikey'] || req.body?.apiKey || req.body?.password;
        const globalKey = process.env.AUTHENTICATION_API_KEY;
        const adminPass = process.env.ADMIN_PASSWORD || globalKey;

        if (!key || (key !== globalKey && key !== adminPass)) {
          return res.status(HttpStatus.UNAUTHORIZED).json({
            status: HttpStatus.UNAUTHORIZED,
            valid: false,
            message: 'Invalid Master Admin Password or API Key',
          });
        }

        return res.status(HttpStatus.OK).json({
          status: HttpStatus.OK,
          valid: true,
          apiKey: globalKey,
        });
      })
      // Reset user password with custom password or auto-generated unique password
      .post('/:id/reset-password', ...guards, async (req, res) => {
        const { password } = req.body || {};
        const response = await userController.resetPassword(req.params.id, password);
        return res.status(HttpStatus.OK).json(response);
      })
      // Create a new user with name, email, password (optional, falls back to .env)
      .post('/create', ...guards, async (req, res) => {
        const { name, email, password } = req.body;
        const response = await userController.createUser({ name, email, password });
        return res.status(HttpStatus.CREATED).json(response);
      })
      // List all users and their linked instance
      .get('/list', ...guards, async (_req, res) => {
        const response = await userController.listUsers();
        return res.status(HttpStatus.OK).json(response);
      })
      // Get single user by id
      .get('/:id', ...guards, async (req, res) => {
        const response = await userController.getUserById(req.params.id);
        return res.status(HttpStatus.OK).json(response);
      })
      // Update user name, email, or password
      .patch('/:id', ...guards, async (req, res) => {
        const { name, email, password } = req.body;
        const response = await userController.updateUser(req.params.id, { name, email, password });
        return res.status(HttpStatus.OK).json(response);
      })
      // Delete user
      .delete('/:id', ...guards, async (req, res) => {
        const response = await userController.deleteUser(req.params.id);
        return res.status(HttpStatus.OK).json(response);
      });
  }
}
