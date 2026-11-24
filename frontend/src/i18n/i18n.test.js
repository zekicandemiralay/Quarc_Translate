import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import en from './en.json';
import tr from './tr.json';

const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));

const enFlat = Object.fromEntries(flatten(en));
const trFlat = Object.fromEntries(flatten(tr));
const placeholders = (s) => [...String(s).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

describe('translations', () => {
  it('Turkish has exactly the keys English has', () => {
    expect(Object.keys(trFlat).sort()).toEqual(Object.keys(enFlat).sort());
  });

  it('no string is empty', () => {
    for (const [k, v] of [...Object.entries(enFlat), ...Object.entries(trFlat)]) expect(String(v).trim(), k).not.toBe('');
  });

  it('both languages use the same {{placeholders}}', () => {
    for (const k of Object.keys(enFlat)) expect(placeholders(trFlat[k]), k).toEqual(placeholders(enFlat[k]));
  });

  it('every key the code asks for exists', () => {
    const root = path.resolve(__dirname, '..');
    const files = [];
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (/\.(jsx?)$/.test(name) && !/\.test\./.test(name)) files.push(full);
      }
    };
    walk(root);

    const used = new Set();
    const dynamicPrefixes = new Set();
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*['"`]([\w.]+)(\$\{)?/g)) {
        if (m[2]) dynamicPrefixes.add(m[1]);
        else used.add(m[1]);
      }
    }
    expect(used.size).toBeGreaterThan(80);
    const missing = [...used].filter((k) => !(k in enFlat));
    expect(missing).toEqual([]);

    // t(`preparing.${stage}`) etc.: the prefix must at least exist as a group.
    for (const prefix of dynamicPrefixes) {
      expect(Object.keys(enFlat).some((k) => k.startsWith(prefix)), prefix).toBe(true);
    }
  });
});
