import { InstanceDto } from '@api/dto/instance.dto';
import { ProxyDto } from '@api/dto/proxy.dto';
import { WAMonitoringService } from '@api/services/monitor.service';
import { ProxyService } from '@api/services/proxy.service';
import { Logger } from '@config/logger.config';
import { BadRequestException, NotFoundException } from '@exceptions';
import { makeProxyAgent } from '@utils/makeProxyAgent';
import axios from 'axios';

const logger = new Logger('ProxyController');

export class ProxyController {
  constructor(
    private readonly proxyService: ProxyService,
    private readonly waMonitor: WAMonitoringService,
  ) {}

  public async createProxy(instance: InstanceDto, data: ProxyDto) {
    if (!this.waMonitor.waInstances[instance.instanceName]) {
      throw new NotFoundException(`The "${instance.instanceName}" instance does not exist`);
    }

    if (!data?.enabled) {
      data.host = '';
      data.port = '';
      data.protocol = '';
      data.username = '';
      data.password = '';
    }

    if (data.host) {
      const testProxy = await this.testProxy(data);
      if (!testProxy) {
        throw new BadRequestException('Invalid proxy');
      }
    }

    return this.proxyService.create(instance, data);
  }

  public async findProxy(instance: InstanceDto) {
    if (!this.waMonitor.waInstances[instance.instanceName]) {
      throw new NotFoundException(`The "${instance.instanceName}" instance does not exist`);
    }

    return this.proxyService.find(instance);
  }

  public async testProxy(proxy: ProxyDto) {
    try {
      const host = (proxy.host || '').trim();
      const isDynamic =
        host.includes('proxyscrape') ||
        host.includes('free-proxy-list') ||
        host.includes('display_proxies') ||
        host.includes('raw.githubusercontent.com');

      if (isDynamic) {
        logger.info(`testProxy: validating dynamic proxy list endpoint: ${host}`);
        const listRes = await axios.get(host, { timeout: 8000 });
        const hasContent = typeof listRes.data === 'string' && listRes.data.trim().length > 0;
        if (listRes.status === 200 && hasContent) {
          logger.info('testProxy: dynamic proxy list endpoint is active and returning proxies');
          return true;
        }
        return false;
      }

      const serverIp = await axios.get('https://icanhazip.com/', { timeout: 6000 });
      const response = await axios.get('https://icanhazip.com/', {
        httpsAgent: makeProxyAgent(proxy),
        timeout: 10000,
      });

      const result = response?.data !== serverIp?.data;
      if (result) {
        logger.info('testProxy: proxy connection successful');
      } else {
        logger.warn("testProxy: proxy connection doesn't change the origin IP");
      }

      return result;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error('testProxy error: axios error: ' + error.message);
      } else {
        logger.error('testProxy error: unexpected error: ' + error);
      }

      return false;
    }
  }
}
