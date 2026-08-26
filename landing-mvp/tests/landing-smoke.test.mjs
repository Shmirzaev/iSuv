import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = (await Promise.all(['styles.css', 'base.css', 'story.css', 'sections.css', 'responsive.css'].map((name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8')))).join('\n');
const js = await readFile(new URL('../app.js', import.meta.url), 'utf8');

test('landing includes the approval-MVP sections', () => {
  for (const id of ['top', 'story', 'workspace', 'governance', 'contact']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /Command Dashboard/);
  assert.match(html, /Live Operations/);
  assert.match(html, /Network Map/);
  assert.match(html, /Reports & Audit/);
});

test('measurement units remain explicit and distinct', () => {
  assert.match(html, /Suv sathi[\s\S]*?1\.82[\s\S]*?<small>m<\/small>/);
  assert.match(html, /Oqim[\s\S]*?8\.74[\s\S]*?<small>m³\/s<\/small>/);
  assert.match(html, /Bugun yetkazildi[\s\S]*?524,310[\s\S]*?<small>m³<\/small>/);
});

test('synthetic data and monitoring-only boundary are visible', () => {
  assert.match(html, /Sintetik MVP/);
  assert.match(html, /Barcha ko‘rsatkichlar sintetik/);
  assert.match(html, /MVP real darvoza, nasos yoki RTU’ni avtonom boshqarmaydi/);
});

test('motion and accessibility controls exist', () => {
  assert.match(html, /data-motion-toggle/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(html, /skip-link/);
  assert.match(js, /IntersectionObserver/);
});
