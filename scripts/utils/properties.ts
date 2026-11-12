export const PREFIX = "/data/data/com.termux/files/usr";
export const HOME = "/data/data/com.termux/files/home";
export const TERMUX_PREFIX = PREFIX;
export const TERMUX_HOME = HOME;

export class SystemProperties {
  get prefix(): string {
    return PREFIX;
  }

  get binDir(): string {
    return `${PREFIX}/bin`;
  }

  get libDir(): string {
    return `${PREFIX}/lib`;
  }

  get includeDir(): string {
    return `${PREFIX}/include`;
  }

  getEnvVars(): Record<string, string> {
    return {
      PREFIX: this.prefix,
      CFLAGS: `-I${this.includeDir}`,
      CPPFLAGS: `-I${this.includeDir}`,
      LDFLAGS: `-L${this.libDir} -Wl,-rpath=${this.libDir}`,
    };
  }
}
