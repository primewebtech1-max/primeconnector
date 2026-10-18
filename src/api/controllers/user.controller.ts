import { InstanceDto } from '@api/dto/instance.dto';
import { CreateUserData, LoginUserData, UpdateUserData, UserService } from '@api/services/user.service';

export class UserController {
  constructor(private readonly userService: UserService) {}

  // ---------------- Superuser Admin Actions ----------------
  public async createUser(data: CreateUserData) {
    return await this.userService.createUser(data);
  }

  public async listUsers() {
    return await this.userService.listUsers();
  }

  public async getUserById(id: string) {
    return await this.userService.getUserById(id);
  }

  public async updateUser(id: string, data: UpdateUserData) {
    return await this.userService.updateUser(id, data);
  }

  public async deleteUser(id: string) {
    return await this.userService.deleteUser(id);
  }

  public async resetPassword(id: string, password?: string) {
    return await this.userService.resetPassword(id, password);
  }

  // ---------------- User Portal Actions ----------------
  public async login(data: LoginUserData) {
    return await this.userService.login(data);
  }

  public async getMe(userId: string) {
    return await this.userService.getMe(userId);
  }

  public async createUserInstance(userId: string, instanceData: InstanceDto) {
    return await this.userService.createUserInstance(userId, instanceData);
  }

  public async getUserInstanceLive(userId: string) {
    return await this.userService.getUserInstanceLive(userId);
  }

  public async connectUserInstance(userId: string, phoneNumber?: string) {
    return await this.userService.connectUserInstance(userId, phoneNumber);
  }

  public async restartUserInstance(userId: string) {
    return await this.userService.restartUserInstance(userId);
  }

  public async logoutUserInstance(userId: string) {
    return await this.userService.logoutUserInstance(userId);
  }

  public async deleteUserInstance(userId: string) {
    return await this.userService.deleteUserInstance(userId);
  }

  public async sendUserMessage(userId: string, data: { number: string; text: string }) {
    return await this.userService.sendUserMessage(userId, data);
  }
}
