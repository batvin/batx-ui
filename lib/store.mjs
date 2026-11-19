import fs from 'node:fs';
import path from 'node:path';
import {randomBytes, scryptSync, timingSafeEqual, createCipheriv, createDecipheriv} from 'node:crypto';

export function hashPassword(password) {
  const salt = randomBytes(24).toString('hex');
  return {salt, hash: scryptSync(password, salt, 64).toString('hex')};
}
export function verifyPassword(password, record) {
  if (typeof password !== 'string' || password.length > 1024 || !record?.salt || !record?.hash) return false;
  const expected = Buffer.from(record.hash, 'hex');
  const actual = scryptSync(password, record.salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('Password must contain 12–256 characters.');
}
export class Store {
  constructor(directory, username, password) {
    this.directory = path.resolve(directory);
    fs.mkdirSync(this.directory, {recursive:true, mode:0o700});
    this.file = path.join(this.directory, 'state.json');
    const keyFile = path.join(this.directory, 'master.key');
    if (fs.existsSync(this.file) && !fs.existsSync(keyFile)) throw new Error('master.key is missing. Restore the complete data backup; do not create a new key.');
    if (!fs.existsSync(keyFile)) {
      validatePassword(password);
      if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(username)) throw new Error('Invalid admin username. Use 3–64 ASCII letters, numbers, dots, underscores or hyphens.');
      fs.writeFileSync(keyFile, randomBytes(32), {mode:0o600, flag:'wx'});
    }
    this.key = fs.readFileSync(keyFile);
    if (this.key.length !== 32) throw new Error('Invalid master.key. Restore a valid backup.');
    if (fs.existsSync(this.file)) {
      this.state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!this.state.admin?.hash) throw new Error('Invalid state file. Restore a valid backup.');
    } else {
      validatePassword(password);
      this.state = {version:1, admin:{username,...hashPassword(password)}, settings:null, audit:[]};
      this.save();
    }
  }
  encrypt(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value),'utf8'), cipher.final()]);
    return {iv:iv.toString('base64'), tag:cipher.getAuthTag().toString('base64'), value:encrypted.toString('base64')};
  }
  decrypt(value) {
    const cipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(value.iv,'base64'));
    cipher.setAuthTag(Buffer.from(value.tag,'base64'));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.value,'base64')),cipher.final()]).toString('utf8'));
  }
  settings() {return this.state.settings ? this.decrypt(this.state.settings) : null;}
  setSettings(settings) {this.state.settings=this.encrypt(settings);this.save();}
  setPassword(password) {validatePassword(password);this.state.admin={username:this.state.admin.username,...hashPassword(password)};this.save();}
  audit(action, target='', success=true) {
    this.state.audit.unshift({time:new Date().toISOString(),action,target:String(target).slice(0,100),success});
    this.state.audit=this.state.audit.slice(0,500);
    this.save();
  }
  save() {
    const temp = this.file + '.tmp';
    const fd = fs.openSync(temp, 'w', 0o600);
    try {fs.writeFileSync(fd, JSON.stringify(this.state,null,2));fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
    fs.renameSync(temp,this.file);
    fs.chmodSync(this.file,0o600);
  }
}
