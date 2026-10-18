import { InstanceDto } from '@api/dto/instance.dto';
import { getJwtSecret } from '@api/guards/portal.guard';
import { PrismaRepository } from '@api/repository/repository.service';
import { instanceController, sendMessageController, waMonitor } from '@api/server.module';
import { Integration } from '@api/types/wa.types';
import { Logger } from '@config/logger.config';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@exceptions';
import { hashPassword, verifyPassword } from '@utils/password.util';
import jwt from 'jsonwebtoken';

export interface CreateUserData {
  name: string;
  email: string;
  password?: string;
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

  private readonly logger = new Logger('UserService');

  // ----------------------------------------------------
  // Superuser Admin Methods
  // ----------------------------------------------------

  public async createUser(data: CreateUserData) {
    if (!data.name || !data.email) {
      throw new BadRequestException('Name and email are required');
    }

    // Require strong password (minimum 8 chars) or generate a strong cryptographically unique password
    let rawPassword = '';
    if (data.password && data.password.trim().length > 0) {
      if (data.password.trim().length < 8) {
        throw new BadRequestException('Password must be at least 8 characters long');
      }
      rawPassword = data.password.trim();
    } else {
      // Auto-generate unique 14-char high-entropy password
      const crypto = await import('crypto');
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*';
      const bytes = crypto.randomBytes(14);
      for (let i = 0; i < 14; i++) {
        rawPassword += chars[bytes[i] % chars.length];
      }
    }

    const normalizedEmail = data.email.trim().toLowerCase();

    const existingUser = await this.prismaRepository.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      throw new BadRequestException('A user with this email already exists');
    }

    const hashedPassword = hashPassword(rawPassword);

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

    return {
      ...user,
      appliedPassword: rawPassword,
    };
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

  public async resetPassword(id: string, newPassword?: string) {
    const user = await this.prismaRepository.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }

    let appliedPassword = '';
    if (newPassword && newPassword.trim().length > 0) {
      if (newPassword.trim().length < 8) {
        throw new BadRequestException('Password must be at least 8 characters long');
      }
      appliedPassword = newPassword.trim();
    } else {
      // Generate a strong, unique 14-char password
      const crypto = await import('crypto');
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*';
      const bytes = crypto.randomBytes(14);
      for (let i = 0; i < 14; i++) {
        appliedPassword += chars[bytes[i] % chars.length];
      }
    }

    const hashedPassword = hashPassword(appliedPassword);

    await this.prismaRepository.user.update({
      where: { id },
      data: { password: hashedPassword },
    });

    return {
      status: 'SUCCESS',
      message: 'Password updated successfully',
      newPassword: appliedPassword,
    };
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
    let livePhone = instance?.number || null;
    let liveProfile = instance?.profileName || null;

    if (instance && waMonitor.waInstances[instance.name]) {
      const liveInst = waMonitor.waInstances[instance.name] as any;
      const liveStatus = liveInst?.connectionStatus;
      liveState = typeof liveStatus === 'string' ? liveStatus : liveStatus?.state || liveState;

      const clientUser = liveInst?.client?.user;
      if (clientUser?.id) {
        livePhone = clientUser.id.split(':')[0].split('@')[0];
      } else if (liveInst?.instance?.number) {
        livePhone = liveInst.instance.number;
      }
      if (clientUser?.name || clientUser?.verifiedName) {
        liveProfile = clientUser.name || clientUser.verifiedName;
      } else if (liveInst?.instance?.profileName) {
        liveProfile = liveInst.instance.profileName;
      }

      if (livePhone && instance.number !== livePhone) {
        this.prismaRepository.instance
          .update({
            where: { id: instance.id },
            data: { number: livePhone, profileName: liveProfile },
          })
          .catch(() => {});
      }
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
            number: livePhone,
            profileName: liveProfile,
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
    let cleanName = (
      instanceData.instanceName ||
      `${user.name.toLowerCase().replace(/[^a-z0-9]/g, '')}_${Date.now().toString().slice(-4)}`
    )
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
      instanceData.integration =
        normalized === 'WHATSAPP-BAILEYS' ? Integration.WHATSAPP_BAILEYS : instanceData.integration;
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

    let livePhone = null;
    let liveProfile = null;
    if (state === 'open') {
      const clientUser = (liveInstance as any)?.client?.user;
      if (clientUser?.id) {
        livePhone = clientUser.id.split(':')[0].split('@')[0];
      } else if ((liveInstance as any)?.instance?.number) {
        livePhone = (liveInstance as any).instance.number;
      } else if (instanceDb.number) {
        livePhone = instanceDb.number;
      }
      if (clientUser?.name || clientUser?.verifiedName) {
        liveProfile = clientUser.name || clientUser.verifiedName;
      } else if ((liveInstance as any)?.instance?.profileName) {
        liveProfile = (liveInstance as any).instance.profileName;
      } else if (instanceDb.profileName) {
        liveProfile = instanceDb.profileName;
      }
    }

    return {
      id: instanceDb.id,
      name: instanceDb.name,
      token: instanceDb.token,
      number: livePhone,
      profileName: liveProfile,
      profilePicUrl: instanceDb.profilePicUrl || (liveInstance as any)?.instance?.profilePicUrl,
      status: state,
      qrcode: liveInstance?.qrCode || (liveInstance as any)?.instance?.qrcode || null,
      pairingCode:
        (liveInstance as any)?.pairingCode ||
        (liveInstance as any)?.instance?.qrcode?.pairingCode ||
        liveInstance?.qrCode?.pairingCode ||
        null,
    };
  }

  public async connectUserInstance(userId: string, phoneNumber?: string) {
    const userInstance = await this.getUserInstanceLive(userId);
    if (!userInstance) {
      throw new NotFoundException('No instance found for this user. Please create your instance first.');
    }

    // Auto-format phone: if 10 digits (Indian mobile standard), prepend 91!
    let formattedPhone: string | null = null;
    if (phoneNumber && phoneNumber.trim().length > 0) {
      const cleanDigits = phoneNumber.trim().replace(/\D/g, '');
      if (cleanDigits.length === 10) {
        formattedPhone = `91${cleanDigits}`;
      } else if (cleanDigits.length === 11 && cleanDigits.startsWith('0')) {
        formattedPhone = `91${cleanDigits.slice(1)}`;
      } else {
        formattedPhone = cleanDigits;
      }
    }

    const liveInstance = waMonitor.waInstances[userInstance.name] as any;
    if (liveInstance) {
      // If user wants QR (no phone supplied), wipe any residual phoneNumber so Baileys does not request a pairing code!
      if (!formattedPhone) {
        liveInstance.phoneNumber = null;
        if (liveInstance.instance?.qrcode) {
          liveInstance.instance.qrcode.pairingCode = null;
        }
      }
    }

    const result = await instanceController.connectToWhatsapp({
      instanceName: userInstance.name,
      number: formattedPhone || null,
    });

    // POLLING WAIT LOOP: Wait up to 6 seconds for QR base64 or pairing code to be generated!
    // This eliminates the blank / stuck loading screen completely!
    const startTime = Date.now();
    let qrObj = result?.qrcode || liveInstance?.qrCode || liveInstance?.instance?.qrcode;
    let pairingCode =
      result?.pairingCode ||
      (result as any)?.instance?.qrcode?.pairingCode ||
      liveInstance?.instance?.qrcode?.pairingCode ||
      liveInstance?.pairingCode;

    while (Date.now() - startTime < 6000) {
      if (formattedPhone && pairingCode) break;
      if (!formattedPhone && (qrObj?.base64 || qrObj?.code)) break;

      await new Promise((resolve) => setTimeout(resolve, 300));

      const freshLive = waMonitor.waInstances[userInstance.name] as any;
      qrObj = freshLive?.qrCode || freshLive?.instance?.qrcode || qrObj;
      pairingCode = freshLive?.instance?.qrcode?.pairingCode || freshLive?.pairingCode || pairingCode;
    }

    const freshLive = waMonitor.waInstances[userInstance.name] as any;
    const finalQr =
      qrObj?.base64 || qrObj?.code
        ? qrObj
        : result?.base64 || result?.code
          ? result
          : freshLive?.qrCode || freshLive?.instance?.qrcode;

    return {
      ...result,
      formattedPhone,
      pairingCode: pairingCode || finalQr?.pairingCode || null,
      qrcode: finalQr || null,
      base64: finalQr?.base64 || null,
      code: finalQr?.code || null,
    };
  }

  public async restartUserInstance(userId: string) {
    const userInstance = await this.getUserInstanceLive(userId);
    if (!userInstance) {
      throw new NotFoundException('No instance found for this user.');
    }

    return await instanceController.restartInstance({ instanceName: userInstance.name });
  }

  public async logoutUserInstance(userId: string) {
    const user = await this.prismaRepository.user.findUnique({
      where: { id: userId },
      include: { instances: true },
    });

    if (!user || !user.instances || user.instances.length === 0) {
      throw new NotFoundException('No instance found for this user.');
    }

    const instanceDb = user.instances[0];
    const liveInstance = waMonitor.waInstances[instanceDb.name] as any;

    // 1. Gracefully disconnect and terminate any active Baileys client WebSocket
    try {
      if (liveInstance?.client) {
        try {
          await liveInstance.client.logout?.('Portal user requested logout');
        } catch (e: any) {
          this.logger.warn(`Logout error: ${e?.message || e}`);
        }
        try {
          liveInstance.client.ws?.close?.();
          liveInstance.client.end?.(new Error('Logout by user'));
        } catch (e: any) {
          this.logger.warn(`Close client error: ${e?.message || e}`);
        }
      }
    } catch (e: any) {
      this.logger.warn(`Disconnect client error: ${e?.message || e}`);
    }

    // 2. Clear credentials and session from database
    try {
      await this.prismaRepository.session.deleteMany({
        where: { sessionId: instanceDb.id },
      });
    } catch (e) {
      this.logger.warn(`Could not delete session record for ${instanceDb.id}: ${e}`);
    }

    // 3. Clear instance database record
    try {
      await this.prismaRepository.instance.update({
        where: { id: instanceDb.id },
        data: {
          number: null,
          profileName: null,
          profilePicUrl: null,
          connectionStatus: 'close',
          disconnectionAt: new Date(),
        },
      });
    } catch (e) {
      this.logger.warn(`Could not update instance status for ${instanceDb.id}: ${e}`);
    }

    // 4. Reset in-memory instance state and clear any residual phone number
    if (liveInstance) {
      liveInstance.phoneNumber = null;
      if (liveInstance.instance) {
        liveInstance.instance.number = null;
        liveInstance.instance.profileName = null;
        liveInstance.instance.profilePicUrl = null;
        liveInstance.instance.qrcode = { count: 0, code: null, base64: null };
      }
      liveInstance.stateConnection = { state: 'close' };
      liveInstance.client = null;
    }

    // 5. Clean local disk auth directory if exists
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const { INSTANCE_DIR } = await import('@config/path.config');
      const dir = path.join(INSTANCE_DIR, instanceDb.id);
      await fs.rm(dir, { recursive: true, force: true });
    } catch (e: any) {
      this.logger.warn(`Clean auth dir error: ${e?.message || e}`);
    }

    return { status: 'SUCCESS', message: 'WhatsApp session disconnected and wiped successfully' };
  }

  public async deleteUserInstance(userId: string) {
    const userInstance = await this.getUserInstanceLive(userId);
    if (!userInstance) {
      throw new NotFoundException('No instance found for this user.');
    }

    return await instanceController.deleteInstance({ instanceName: userInstance.name });
  }

  public async sendUserMessage(userId: string, data: { number: string; text: string }) {
    const userInstance = await this.getUserInstanceLive(userId);
    if (!userInstance) {
      throw new NotFoundException('No instance found for this user. Please provision your instance first.');
    }

    if (!data?.number || !data?.text) {
      throw new BadRequestException('Recipient phone number and message text are required');
    }

    // Auto-sanitize phone number: if 10 digits (Indian mobile standard), prepend 91!
    const cleanDigits = data.number.trim().replace(/\D/g, '');
    let formattedPhone = cleanDigits;
    if (cleanDigits.length === 10) {
      formattedPhone = `91${cleanDigits}`;
    } else if (cleanDigits.length === 11 && cleanDigits.startsWith('0')) {
      formattedPhone = `91${cleanDigits.slice(1)}`;
    }

    const waInst = waMonitor.waInstances[userInstance.name];
    if (!waInst) {
      throw new BadRequestException(
        `WhatsApp session "${userInstance.name}" is not loaded. Please connect your instance.`,
      );
    }

    const state =
      typeof waInst.connectionStatus === 'string' ? waInst.connectionStatus : waInst.connectionStatus?.state;
    if (state !== 'open') {
      throw new BadRequestException(
        `WhatsApp instance is not connected (current state: ${state || 'offline'}). Please scan QR first.`,
      );
    }

    return await sendMessageController.sendText({ instanceName: userInstance.name }, {
      number: formattedPhone,
      text: data.text,
    } as any);
  }
}
