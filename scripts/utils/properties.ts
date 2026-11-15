import pkg from '../../package.json';

export const REPOEXE_VERSION = pkg.version;
export const PREFIX = process.env.PREFIX || '/data/data/com.termux/files/usr';
export const HOME = process.env.HOME || '/data/data/com.termux/files/home';
