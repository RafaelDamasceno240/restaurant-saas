'use strict';

// Tests of the pure parts of deploy/backup.js (no Docker, no database). The backup and the
// restore check themselves were run end to end against the stack (deploy/README.md, "Backup").
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { normalizeSchema, isInside } = require('./backup');

test('normalizeSchema drops comments, settings, blank lines and the per-run restrict key', () => {
  const a = '--\n-- PostgreSQL database dump\n--\n\\restrict abc123\nSET statement_timeout = 0;\nSELECT pg_catalog.set_config(\'search_path\', \'\', false);\n\nCREATE TABLE public.t (id integer);\n\\unrestrict abc123\n';
  const b = '\\restrict zzz999\nSET lock_timeout = 0;\nCREATE TABLE public.t (id integer);\n-- Completed\n\\unrestrict zzz999\n';
  assert.equal(normalizeSchema(a), 'CREATE TABLE public.t (id integer);');
  assert.equal(normalizeSchema(a), normalizeSchema(b));
});

test('normalizeSchema keeps a real schema difference visible', () => {
  assert.notEqual(normalizeSchema('CREATE TABLE public.t (id integer);'), normalizeSchema('CREATE TABLE public.t (id bigint);'));
});

test('isInside refuses the repository and its subfolders, accepts a sibling folder', () => {
  const repo = path.resolve('/projects/restaurant-saas');
  assert.equal(isInside(repo, repo), true);
  assert.equal(isInside(path.join(repo, 'deploy', 'backups'), repo), true);
  assert.equal(isInside(path.resolve('/projects/restaurant-saas-backups/homolog'), repo), false);
  assert.equal(isInside(path.resolve('/elsewhere'), repo), false);
});
