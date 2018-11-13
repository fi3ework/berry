import libzip              from '@berry/libzip';
import {ReadStream, Stats} from 'fs';
import {posix}             from 'path';
import {PassThrough}       from 'stream';

import {FakeFS}            from './FakeFS';
import {NodeFS}            from './NodeFS';

const IS_DIRECTORY_STAT = {
  isBlockDevice: () => false,
  isCharacterDevice: () => false,
  isDirectory: () => true,
  isFIFO: () => false,
  isFile: () => false,
  isSocket: () => false,
  isSymbolicLink: () => false,

  dev: 0,
  ino: 0,
  mode: 755,
  nlink: 1,
  rdev: 0,
  blocks: 1,
};

const IS_FILE_STAT = {
  isBlockDevice: () => false,
  isCharacterDevice: () => false,
  isDirectory: () => false,
  isFIFO: () => false,
  isFile: () => true,
  isSocket: () => false,
  isSymbolicLink: () => false,

  dev: 0,
  ino: 0,
  mode: 644,
  nlink: 1,
  rdev: 0,
  blocks: 1,
};

export type Options = {
  baseFs?: FakeFS,
  create?: boolean,
  stats?: Stats,
};

export class ZipFS extends FakeFS {
  private readonly path: string;

  private readonly baseFs: FakeFS;

  private readonly stats: Stats;
  private readonly zip: number;

  private readonly listings: Map<string, Set<string>> = new Map();
  private readonly entries: Map<string, number> = new Map();

  constructor(p: string, {baseFs = new NodeFS(), create = false, stats}: Options = {}) {
    super();

    this.path = p;

    this.baseFs = baseFs;

    if (stats) {
      this.stats = stats;
    } else {
      try {
        this.stats = this.baseFs.statSync(p);
      } catch (error) {
        if (error.code === `ENOENT` && create) {
          this.stats = {... IS_FILE_STAT, uid: 0, gid: 0, size: 0, blksize: 0, atimeMs: 0, mtimeMs: 0, ctimeMs: 0, birthtimeMs: 0, atime: new Date(0), mtime: new Date(0), ctime: new Date(0), birthtime: new Date(0)};
        } else {
          throw error;
        }
      }
    }

    const errPtr = libzip.malloc(4);

    try {
      let flags = 0;

      if (create)
        flags |= libzip.ZIP_CREATE | libzip.ZIP_TRUNCATE;

      this.zip = libzip.open(p, flags, errPtr);

      if (this.zip === 0) {
        const error = libzip.struct.errorS();
        libzip.error.initWithCode(error, libzip.getValue(errPtr, `i32`));

        throw new Error(libzip.error.strerror(error));
      }
    } finally {
      libzip.free(errPtr);
    }

    const entryCount = libzip.getNumEntries(this.zip, 0);

    this.listings.set(`/`, new Set());

    for (let t = 0; t < entryCount; ++t) {
      const raw = libzip.getName(this.zip, t, 0);
      
      if (posix.isAbsolute(raw))
        continue;

      const p = posix.resolve(`/`, raw);

      this.registerEntry(p, t);
    }
  }

  getRealPath() {
    return this.path;
  }

  close() {
    const rc = libzip.close(this.zip);

    if (rc === -1)
      throw new Error(libzip.error.strerror(libzip.getError(this.zip)));

    return this.path;
  }

  discard() {
    libzip.discard(this.zip);

    return this.path;
  }

  createReadStream(p: string, {encoding}: {encoding?: string} = {}): ReadStream {
    const stream = Object.assign(new PassThrough(), {
      bytesRead: 0,
      path: p,
      close: () => {
        clearImmediate(immediate);
      }
    });

    const immediate = setImmediate(() => {
      const data = this.readFileSync(p, encoding);
  
      stream.bytesRead = data.length;
      stream.write(data);
      stream.end();
    });

    return stream;
  }

  async realpathPromise(p: string) {
    return this.realpathSync(p);
  }

  realpathSync(p: string): string {
    const resolvedP = this.resolveFilename(`lstat '${p}'`, p);
    
    if (!this.entries.has(resolvedP) && !this.listings.has(resolvedP))
      throw Object.assign(new Error(`ENOENT: no such file or directory, lstat '${p}'`), {code: `ENOENT`});
    
    return resolvedP;
  }

  async existsPromise(p: string) {
    return this.existsSync(p);
  }

  existsSync(p: string): boolean {
    let resolvedP;

    try {
      resolvedP = this.resolveFilename(`stat '${p}'`, p);
    } catch (error) {
      return false;
    }
      
    return this.entries.has(resolvedP) || this.listings.has(resolvedP);
  }

  async statPromise(p: string) {
    return this.statSync(p);
  }

  statSync(p: string) {
    const resolvedP = this.resolveFilename(`stat '${p}'`, p);
    
    if (!this.entries.has(resolvedP) && !this.listings.has(resolvedP))
      throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${p}'`), {code: `ENOENT`});

    if (p[p.length - 1] === `/` && !this.listings.has(resolvedP))
      throw Object.assign(new Error(`ENOTDIR: not a directory, stat '${p}'`), {code: `ENOTDIR`});

    return this.statImpl(`stat '${p}'`, p);
  }

  async lstatPromise(p: string) {
    return this.lstatSync(p);
  }

  lstatSync(p: string) {
    const resolvedP = this.resolveFilename(`lstat '${p}'`, p, false);
    
    if (!this.entries.has(resolvedP) && !this.listings.has(resolvedP))
      throw Object.assign(new Error(`ENOENT: no such file or directory, lstat '${p}'`), {code: `ENOENT`});

    if (p[p.length - 1] === `/` && !this.listings.has(resolvedP))
      throw Object.assign(new Error(`ENOTDIR: not a directory, lstat '${p}'`), {code: `ENOTDIR`});

    return this.statImpl(`lstat '${p}'`, p);
  }

  private statImpl(reason: string, p: string): Stats {
    if (this.listings.has(p)) {
      const uid = this.stats.uid;
      const gid = this.stats.gid;

      const size = 0;
      const blksize = 512;
      const blocks = 0;

      const atimeMs = this.stats.mtimeMs;
      const birthtimeMs = this.stats.mtimeMs;
      const ctimeMs = this.stats.mtimeMs;
      const mtimeMs = this.stats.mtimeMs;

      const atime = new Date(atimeMs);
      const birthtime = new Date(birthtimeMs);
      const ctime = new Date(ctimeMs);
      const mtime = new Date(mtimeMs);

      return Object.assign({uid, gid, size, blksize, blocks, atime, birthtime, ctime, mtime, atimeMs, birthtimeMs, ctimeMs, mtimeMs}, IS_DIRECTORY_STAT);
    }

    const entry = this.entries.get(p);

    if (entry !== undefined) {
      const stat = libzip.struct.statS();

      const rc = libzip.statIndex(this.zip, entry, 0, 0, stat);
      if (rc === -1)
        throw new Error(libzip.error.strerror(libzip.getError(this.zip)));

      const uid = this.stats.uid;
      const gid = this.stats.gid;

      const size = (libzip.struct.statSize(stat) >>> 0);
      const blksize = 512;
      const blocks = Math.ceil(size / blksize);

      const mtimeMs = (libzip.struct.statMtime(stat) >>> 0) * 1000;
      const atimeMs = mtimeMs;
      const birthtimeMs = mtimeMs;
      const ctimeMs = mtimeMs;

      const atime = new Date(atimeMs);
      const birthtime = new Date(birthtimeMs);
      const ctime = new Date(ctimeMs);
      const mtime = new Date(mtimeMs);

      return Object.assign({uid, gid, size, blksize, blocks, atime, birthtime, ctime, mtime, atimeMs, birthtimeMs, ctimeMs, mtimeMs}, IS_FILE_STAT);
    }

    throw new Error(`Unreachable`);
  }

  private registerListing(p: string) {
    let listing = this.listings.get(p);

    if (listing)
      return listing;

    const parentListing = this.registerListing(posix.dirname(p));
    listing = new Set();

    parentListing.add(posix.basename(p));
    this.listings.set(p, listing);

    return listing;
  }

  private registerEntry(p: string, index: number) {
    const parentListing = this.registerListing(posix.dirname(p));
    parentListing.add(posix.basename(p));

    this.entries.set(p, index);
  }

  private resolveFilename(reason: string, p: string, resolveLastComponent: boolean = true) {
    let resolvedP = posix.resolve(`/`, p);

    if (resolvedP === `/`)
      return `/`;

    while (true) {
      const parentP = this.resolveFilename(reason, posix.dirname(resolvedP), true);

      const isDir = this.listings.has(parentP);
      const doesExist = this.entries.has(parentP);

      if (!isDir && !doesExist)
        throw Object.assign(new Error(`ENOENT: no such file or directory, ${reason}`), {code: `ENOENT`});
      
      if (!isDir)
        throw Object.assign(new Error(`ENOTDIR: not a directory, ${reason}`), {code: `ENOTDIR`});

      resolvedP = posix.resolve(parentP, posix.basename(resolvedP));

      const index = libzip.name.locate(this.zip, resolvedP);
      if (index === -1 || !resolveLastComponent) {
        break;
      }

      const attrs = libzip.file.getExternalAttributes(this.zip, index, 0, 0, libzip.uint08S, libzip.uint32S);
      if (attrs === -1)
        throw new Error(libzip.error.strerror(libzip.getError(this.zip)));
        
      const opsys = libzip.getValue(libzip.uint08S, `i8`) >>> 0;

      if (opsys === libzip.ZIP_OPSYS_UNIX) {
        const attributes = libzip.getValue(libzip.uint32S, `i32`) >>> 16;

        // Follows symlinks
        if ((attributes & 0o170000) === 0o120000) {
          const target = this.getFileSource(index).toString();
          resolvedP = posix.resolve(posix.dirname(resolvedP), target);
        } else {
          break;
        }
      } else {
        break;
      }
    }
    
    return resolvedP;
  }

  private setFileSource(p: string, content: Buffer | string) {
    if (typeof content === `string`)
      content = Buffer.from(content);

    const buffer = libzip.malloc(content.byteLength);

    if (!buffer)
      throw new Error(`Couldn't allocate enough memory`);

    // Copy the file into the Emscripten heap
    const heap = new Uint8Array(libzip.HEAPU8.buffer, buffer, content.byteLength);
    heap.set(content);

    const source = libzip.source.fromBuffer(this.zip, buffer, content.byteLength, 0, true);

    if (source === 0) {
      libzip.free(buffer);
      throw new Error(libzip.error.strerror(libzip.getError(this.zip)));
    }

    return libzip.file.add(this.zip, posix.relative(`/`, p), source, libzip.ZIP_FL_OVERWRITE);
  }

  private getFileSource(index: number) {
    const stat = libzip.struct.statS();

    const rc = libzip.statIndex(this.zip, index, 0, 0, stat);
    if (rc === -1)
      throw new Error(libzip.error.strerror(libzip.getError(this.zip)));

    const size = libzip.struct.statSize(stat);
    const buffer = libzip.malloc(size);

    try {
      const file = libzip.fopenIndex(this.zip, index, 0, 0);
      if (file === 0)
        throw new Error(libzip.error.strerror(libzip.getError(this.zip)));

      try {
        const rc = libzip.fread(file, buffer, size, 0);

        if (rc === -1)
          throw new Error(libzip.error.strerror(libzip.file.getError(file)));
        else if (rc < size)
          throw new Error(`Incomplete read`);
        else if (rc > size)
          throw new Error(`Overread`);

        const memory = libzip.HEAPU8.subarray(buffer, buffer + size);
        const data = Buffer.from(memory);

        return data;
      } finally {
        libzip.fclose(file);
      }
    } finally {
      libzip.free(buffer);
    }
  }

  async writeFilePromise(p: string, content: Buffer | string) {
    return this.writeFileSync(p, content);
  }

  writeFileSync(p: string, content: Buffer | string) {
    const resolvedP = this.resolveFilename(`open '${p}'`, p);

    if (this.listings.has(resolvedP))
      throw Object.assign(new Error(`EISDIR: illegal operation on a directory, open '${p}'`), {code: `EISDIR`});

    const existed = this.entries.has(resolvedP);
    const index = this.setFileSource(resolvedP, content);

    if (!existed) {
      this.registerEntry(resolvedP, index);
    }
  }

  async mkdirPromise(p: string) {
    return this.mkdirSync(p);
  }

  mkdirSync(p: string) {
    const resolvedP = this.resolveFilename(`mkdir '${p}'`, p);

    if (this.entries.has(resolvedP) || this.listings.has(resolvedP))
      throw Object.assign(new Error(`EEXIST: file already exists, mkdir '${p}'`), {code: `EEXIST`});

    const index = libzip.dir.add(this.zip, posix.relative(`/`, resolvedP));
    if (index === -1)
      throw new Error(libzip.error.strerror(libzip.getError(this.zip)));

    this.registerListing(resolvedP);
    this.registerEntry(resolvedP, index);
  }

  async symlinkPromise(target: string, p: string) {
    return this.symlinkSync(target, p);
  }

  symlinkSync(target: string, p: string) {
    const resolvedP = this.resolveFilename(`symlink '${target}' -> '${p}'`, p);

    if (this.listings.has(resolvedP))
      throw Object.assign(new Error(`EISDIR: illegal operation on a directory, symlink '${target}' -> '${p}'`), {code: `EISDIR`});

    if (this.entries.has(resolvedP))
      throw Object.assign(new Error(`EEXIST: file already exists, symlink '${target}' -> '${p}'`), {code: `EEXIST`});

    const index = this.setFileSource(resolvedP, target);
  
    this.registerEntry(resolvedP, index);

    const rc = libzip.file.setExternalAttributes(this.zip, index, 0, 0, libzip.ZIP_OPSYS_UNIX, (0o120000 | 0o644) << 16);
    if (rc === -1) {
      throw new Error(libzip.error.strerror(libzip.getError(this.zip)));
    }
  }

  readFilePromise(p: string, encoding: 'utf8'): Promise<string>;
  readFilePromise(p: string, encoding?: string): Promise<Buffer>;
  async readFilePromise(p: string, encoding?: string) {
    // This weird switch is required to tell TypeScript that the signatures are proper (otherwise it thinks that only the generic one is covered)
    switch (encoding) {
      case `utf8`:
        return this.readFileSync(p, encoding);
      default:
        return this.readFileSync(p, encoding);
    }
  }

  readFileSync(p: string, encoding: 'utf8'): string;
  readFileSync(p: string, encoding?: string): Buffer;
  readFileSync(p: string, encoding?: string) {
    const resolvedP = this.resolveFilename(`open '${p}'`, p);
    
    if (!this.entries.has(resolvedP) && !this.listings.has(resolvedP))
      throw Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), {code: `ENOENT`});

    // Ensures that the last component is a directory, if the user said so (even if it is we'll throw right after with EISDIR anyway)
    if (p[p.length - 1] === `/` && !this.listings.has(resolvedP))
      throw Object.assign(new Error(`ENOTDIR: not a directory, open '${p}'`), {code: `ENOTDIR`});

    if (this.listings.has(resolvedP))
      throw Object.assign(new Error(`EISDIR: illegal operation on a directory, read`), {code: `EISDIR`});

    const entry = this.entries.get(resolvedP);

    if (entry === undefined)
      throw new Error(`Unreachable`);

    const data = this.getFileSource(entry);

    return encoding ? data.toString(encoding) : data;
  }

  async readdirPromise(p: string) {
    return this.readdirSync(p);
  }

  readdirSync(p: string): Array<string> {
    const resolvedP = this.resolveFilename(`scandir '${p}'`, p);

    if (!this.entries.has(resolvedP) && !this.listings.has(resolvedP))
      throw Object.assign(new Error(`ENOENT: no such file or directory, scandir '${p}'`), {code: `ENOENT`});

    const directoryListing = this.listings.get(resolvedP);

    if (!directoryListing)
      throw Object.assign(new Error(`ENOTDIR: not a directory, scandir '${p}'`), {code: `ENOTDIR`});

    return Array.from(directoryListing);
  }

  async readlinkPromise(p: string) {
    return this.readlinkSync(p);
  }

  readlinkSync(p: string): string {
    const resolvedP = this.resolveFilename(`readlink '${p}'`, p, false);

    if (!this.entries.has(resolvedP) && !this.listings.has(resolvedP))
      throw Object.assign(new Error(`ENOENT: no such file or directory, readlink '${p}'`), {code: `ENOENT`});

    // Ensure that the last component is a directory (if it is we'll throw right after with EISDIR anyway)
    if (p[p.length - 1] === `/` && !this.listings.has(resolvedP))
      throw Object.assign(new Error(`ENOTDIR: not a directory, open '${p}'`), {code: `ENOTDIR`});

    if (this.listings.has(resolvedP))
      throw Object.assign(new Error(`EINVAL: invalid argument, readlink '${p}'`), {code: `EINVAL`});

    const entry = this.entries.get(resolvedP);

    if (entry === undefined)
      throw new Error(`Unreachable`);

    const rc = libzip.file.getExternalAttributes(this.zip, entry, 0, 0, libzip.uint08S, libzip.uint32S);
    if (rc === -1)
      throw new Error(libzip.error.strerror(libzip.getError(this.zip)));
    
    const opsys = libzip.getValue(libzip.uint08S, `i8`) >>> 0;
    if (opsys !== libzip.ZIP_OPSYS_UNIX)
      throw Object.assign(new Error(`EINVAL: invalid argument, readlink '${p}'`), {code: `EINVAL`});

    const attributes = libzip.getValue(libzip.uint32S, `i32`) >>> 16;
    if ((attributes & 0o170000) !== 0o120000)
      throw Object.assign(new Error(`EINVAL: invalid argument, readlink '${p}'`), {code: `EINVAL`});
    
    return this.getFileSource(entry).toString();
  }
};