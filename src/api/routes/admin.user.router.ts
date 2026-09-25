import { RouterBroker } from '@api/abstract/abstract.router';
import { userController } from '@api/server.module';
import { RequestHandler, Router } from 'express';

import { HttpStatus } from './index.router';

export class AdminUserRouter extends RouterBroker {
  public readonly router: Router = Router();

  constructor(...guards: RequestHandler[]) {
    super();

    this.router
      // Create a new user with name, email, password
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
