import { CHAIN, PUSH_NETWORK, VM } from '../constants/enums';

/**
 * Cache entry with timestamp and TTL management
 */
interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number;
}

/**
 * Cache configuration for different types of data
 */
export interface CacheConfig {
  ueaAddress: number;
  deploymentStatus: number;
}

/**
 * Default cache configuration
 */
export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  ueaAddress: 5 * 60 * 1000, // 5 minutes
  deploymentStatus: 1 * 60 * 1000, // 1 minute
};

/**
 * Cache key generators for different data types
 */
export class CacheKeys {
  static ueaAddressOffchain(
    chain: CHAIN,
    address: string,
    pushNetwork: PUSH_NETWORK,
    vm: VM
  ): string {
    return `uea_address_offchain:${chain}:${address}:${pushNetwork}:${vm}`;
  }

  static ueaAddressOnchain(
    chain: CHAIN,
    address: string,
    pushNetwork: PUSH_NETWORK,
    vm: VM
  ): string {
    return `uea_address_onchain:${chain}:${address}:${pushNetwork}:${vm}`;
  }

  static deploymentStatus(address: string): string {
    return `deployment_status:${address}`;
  }
}

/**
 * Generic cache implementation with TTL support
 */
export class Cache<T = any> {
  private cache = new Map<string, CacheEntry<T>>();
  private config: CacheConfig;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
  }

  /**
   * Get a value from cache if it exists and is not expired
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Set a value in cache with TTL
   */
  set(key: string, value: T, ttl?: number): void {
    const now = Date.now();
    const entryTTL = ttl || this.getDefaultTTL(key);

    this.cache.set(key, {
      value,
      timestamp: now,
      ttl: entryTTL,
    });
  }

  /**
   * Get default TTL based on key prefix
   */
  private getDefaultTTL(key: string): number {
    if (key.startsWith('uea_address:')) return this.config.ueaAddress;
    if (key.startsWith('deployment_status:'))
      return this.config.deploymentStatus;

    return 60 * 1000; // Default 1 minute
  }
}

/**
 * Specialized cache for Orchestrator with typed methods
 */
export class OrchestratorCache {
  private cache: Cache;

  constructor(config?: Partial<CacheConfig>) {
    this.cache = new Cache(config);
  }

  getUEAAddress(
    chain: CHAIN,
    address: string,
    pushNetwork: PUSH_NETWORK,
    vm: VM
  ): string | null {
    return this.cache.get(
      CacheKeys.ueaAddressOffchain(chain, address, pushNetwork, vm)
    );
  }

  setUEAAddress(
    chain: CHAIN,
    address: string,
    pushNetwork: PUSH_NETWORK,
    vm: VM,
    ueaAddress: string
  ): void {
    this.cache.set(
      CacheKeys.ueaAddressOffchain(chain, address, pushNetwork, vm),
      ueaAddress
    );
  }
}

/**
 * Specialized cache for Account operations with typed methods
 */
export class AccountCache {
  private cache: Cache;

  constructor(config?: Partial<CacheConfig>) {
    this.cache = new Cache(config);
  }

  getComputedAddress(
    chain: CHAIN,
    address: string,
    pushNetwork: PUSH_NETWORK,
    vm: VM
  ): string | null {
    return this.cache.get(
      CacheKeys.ueaAddressOnchain(chain, address, pushNetwork, vm)
    );
  }

  setComputedAddress(
    chain: CHAIN,
    address: string,
    pushNetwork: PUSH_NETWORK,
    vm: VM,
    computedAddress: string
  ): void {
    this.cache.set(
      CacheKeys.ueaAddressOnchain(chain, address, pushNetwork, vm),
      computedAddress
    );
  }

  getDeploymentStatus(address: string): boolean | null {
    const status = this.cache.get(CacheKeys.deploymentStatus(address));
    return status === null ? null : status === 'deployed';
  }

  setDeploymentStatus(address: string, isDeployed: boolean): void {
    this.cache.set(
      CacheKeys.deploymentStatus(address),
      isDeployed ? 'deployed' : 'not_deployed'
    );
  }
}
