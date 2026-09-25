import { InstanceDto } from '@api/dto/instance.dto';
import { getJwtSecret } from '@api/guards/portal.guard';
import { PrismaRepository } from '@api/repository/repository.service';
import { instanceController, waMonitor } from '@api/server.module';
import { Integration } from '@api/types/wa.types';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@exceptions';
import { hashPassword, verifyPassword } from '@utils/password.util';
import jwt from 'jsonwebtoken';

export interface CreateUserData {
  name: string;
  email: string;
  password: string;
}

export interface UpdateUserData {
  name?: string;
  email?: string;
  password?: string;
}

export interface LoginUserData {
  email: string;
  password: string;
}

export class UserService {
  constructor(private readonly prismaRepository: PrismaRepository) {}

  // ----------------------------------------------------
  // Superuser Admin Methods
  // ----------------------------------------------------

  public async createUser(data: CreateUserData) {
    if (!data.name || !data.email || !data.password) {
      throw new BadRequestException('Name, email, and password are required');
    }

    const normalizedEmail = data.email.trim().toLowerCase();

    const existingUser = await this.prismaRepository.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      throw new BadRequestException('A user with this email already exists');
    }

    const hashedPassword = hashPassword(data.password);

    const user = await this.prismaRepository.user.create({
      data: {
        name: data.name.trim(),
        email: normalizedEmail,
        password: hashedPassword,
      },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return user;
  }

  public async listUsers() {
    const users = await this.prismaRepository.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        instances: {
          select: {
            id: true,
            name: true,
            connectionStatus: true,
            number: true,
            profileName: true,
            profilePicUrl: true,
            token: true,
            createdAt: true,
          },
        },
      },
    });

    return users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      instanceCount: user.instances?.length || 0,
      instance: user.instances?.[0] || null,
    }));
  }

  public async getUserById(id: string) {
    const user = await this.prismaRepository.user.findUnique({
      where: { id },
      include: {
        instances: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      instance: user.instances?.[0] || null,
    };
  }

  public async updateUser(id: string, data: UpdateUserData) {
    const user = await this.prismaRepository.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }

    const updatePayload: any = {};
    if (data.name && data.name.trim().length > 0) {
      updatePayload.name = data.name.trim();
    }
    if (data.email && data.email.trim().length > 0) {
      const normalizedEmail = data.email.trim().toLowerCase();
      if (normalizedEmail !== user.email) {
        const conflict = await this.prismaRepository.user.findUnique({ where: { email: normalizedEmail } });
        if (conflict) {
          throw new BadRequestException('A user with this email already exists');
        }
        updatePayload.email = normalizedEmail;
      }
    }
    if (data.password && data.password.trim().length > 0) {
      updatePayload.password = hashPassword(data.password);
    }

    const updated = await this.prismaRepository.user.update({
      where: { id },
      data: updatePayload,
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return updated;
  }

  public async deleteUser(id: string) {
    const user = await this.prismaRepository.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }

    await this.prismaRepository.user.delete({ where: { id } });
    return { status: 'SUCCESS', message: 'User deleted successfully' };
  }

  // ----------------------------------------------------
  // User Portal Methods
  // ----------------------------------------------------

  public async login(data: LoginUserData) {
    if (!data.email || !data.password) {
      throw new BadRequestException('Email and password are required');
    }

    const normalizedEmail = data.email.trim().toLowerCase();
    const user = await this.prismaRepository.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        instances: {
          select: {
            id: true,
            name: true,
            connectionStatus: true,
          },
        },
      },
    });

    if (!user || !verifyPassword(data.password, user.password)) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const secret = getJwtSecret();
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        name: user.name,
      },
      secret,
      { expiresIn: '7d' },
    );

    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        hasInstance: (user.instances?.length || 0) > 0,
        instanceName: user.instances?.[0]?.name || null,
      },
    };
  }

  public async getMe(userId: string) {
    const user = await this.prismaRepository.user.findUnique({
      where: { id: userId },
      include: {
        instances: {
          select: {
            id: true,
            name: true,
            connectionStatus: true,
            number: true,
            profileName: true,
            profilePicUrl: true,
            token: true,
            createdAt: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const instance = user.instances?.[0] || null;
    let liveState = instance ? instance.connectionStatus : null;

    if (instance && waMonitor.waInstances[instance.name]) {
      const liveStatus = waMonitor.waInstances[instance.name]?.connectionStatus;
      liveState = typeof liveStatus === 'string' ? liveStatus : liveStatus?.state || liveState;
    }

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
      },
      instance: instance
        ? {
            ...instance,
            liveState,
          }
        : null,
    };
  }

  public async createUserInstance(userId: string, instanceData: InstanceDto) {
    const user = await this.prismaRepository.user.findUnique({
      where: { id: userId },
      include: { instances: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // STRICT 1-INSTANCE QUOTA CHECK
    if (user.instances && user.instances.length > 0) {
      throw new BadRequestException(
        `User "${user.name}" already has an instance created ("${user.instances[0].name}"). Maximum 1 instance allowed per user.`,
      );
    }

    // Sanitize instance name (lowercase alphanumeric and hyphens/underscores)
    let cleanName = (instanceData.instanceName || `${user.name.toLowerCase().replace(/[^a-z0-9]/g, '')}_${Date.now().toString().slice(-4)}`)
      .toLowerCase()
      .replace(/\s+/g, '_');

    // Verify name uniqueness
    const exists = await this.prismaRepository.instance.findUnique({ where: { name: cleanName } });
    if (exists) {
      cleanName = `${cleanName}_${Date.now().toString().slice(-4)}`;
    }

    instanceData.instanceName = cleanName;
    if (instanceData.integration) {
      const normalized = instanceData.integration.toUpperCase().replace('_', '-');
      instanceData.integration = normalized === 'WHATSAPP-BAILEYS' ? Integration.WHATSAPP_BAILEYS : instanceData.integration;
    } else {
      instanceData.integration = Integration.WHATSAPP_BAILEYS;
    }

    // Create the instance through core InstanceController
    const created = await instanceController.createInstance(instanceData);

    // Link the created instance to this user in DB
    await this.prismaRepository.instance.update({
      where: { name: cleanName },
      data: { userId: user.id },
    });

    return {
      ...created,
      userId: user.id,
    };
  }

  public async getUserInstanceLive(userId: string) {
    const user = await this.prismaRepository.user.findUnique({
      where: { id: userId },
      include: { instances: true },
    });

    if (!user || !user.instances || user.instances.length === 0) {
      return null;
    }

    const instanceDb = user.instances[0];
    const liveInstance = waMonitor.waInstances[instanceDb.name];

    const state = liveInstance
      ? typeof liveInstance.connectionStatus === 'string'
        ? liveInstance.connectionStatus
        : liveInstance.connectionStatus?.state || 'close'
      : instanceDb.connectionStatus || 'close';

    return {
      id: instanceDb.id,
      name: instanceDb.name,
      token: instanceDb.token,
      number: instanceDb.number,
      profileName: instanceDb.profileName || liveInstance?.instance?.profileName,
      profilePicUrl: instanceDb.profilePicUrl || liveInstance?.instance?.profilePicUrl,
      status: state,
      qrcode: liveInstance?.qrCode || null,
    };
  }

  public async connectUserInstance(userId: string, phoneNumber?: string) {
    const userInstance = await this.getUserInstanceLive(userId);
    if (!userInstance) {
      throw new NotFoundException('No instance found for this user. Please create your instance first.');
    }

    const result = await instanceController.connectToWhatsapp({
      instanceName: userInstance.name,
      number: phoneNumber || null,
    });

    return result;
  }

  public async restartUserInstance(userId: string) {
    const userInstance = await this.getUserInstanceLive(userId);
    if (!userInstance) {
      throw new NotFoundException('No instance found for this user.');
    }

    return await instanceController.restartInstance({ instanceName: userInstance.name });
  }

  public async logoutUserInstance(userId: string) {
    const userInstance = await this.getUserInstanceLive(userId);
    if (!userInstance) {
      throw new NotFoundException('No instance found for this user.');
    }

    return await instanceController.logout({ instanceName: userInstance.name });
  }

  public async deleteUserInstance(userId: string) {
    const userInstance = await this.getUserInstanceLive(userId);
    if (!userInstance) {
      throw new NotFoundException('No instance found for this user.');
    }

    return await instanceController.deleteInstance({ instanceName: userInstance.name });
  }
}
