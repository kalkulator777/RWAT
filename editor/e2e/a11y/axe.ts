/**
 * axe on a screen of the built editor (docs/proposals/editor.md §5.2, §6.3): every state is
 * checked in one go, the `serious` and `critical` violations fail the test, the lesser ones
 * (`moderate`, `minor`) are kept and attached to the test's report so that they can be read
 * and kept in view.
 */

import { writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** A rule that failed on a screen, as the report keeps it. */
export interface Violation {
  state: string;
  rule: string;
  impact: string;
  help: string;
  /** The selectors of the first few elements. */
  nodes: string[];
  count: number;
}

const BLOCKING = new Set(['serious', 'critical']);

/** What a run of states found, filled by {@link audit}. */
export class Audit {
  readonly violations: Violation[] = [];
  readonly states: string[] = [];

  /** Checks the page as it stands and records what axe finds under the name of the state. */
  async at(page: Page, state: string): Promise<void> {
    this.states.push(state);
    const { violations } = await new AxeBuilder({ page }).analyze();
    for (const found of violations) {
      this.violations.push({
        state,
        rule: found.id,
        impact: found.impact ?? 'minor',
        help: found.help,
        nodes: found.nodes.slice(0, 4).map((node) => node.target.join(' ')),
        count: found.nodes.length,
      });
    }
  }

  /** The violations that fail the test. */
  get blocking(): Violation[] {
    return this.violations.filter((found) => BLOCKING.has(found.impact));
  }

  /** The others, by rule: the states each shows in. */
  get lesser(): Record<string, { impact: string; help: string; states: string[] }> {
    const rules: Record<string, { impact: string; help: string; states: string[] }> = {};
    for (const found of this.violations) {
      if (BLOCKING.has(found.impact)) continue;
      const rule = (rules[found.rule] ??= { impact: found.impact, help: found.help, states: [] });
      rule.states.push(found.state);
    }
    return rules;
  }

  /** Attaches the lesser violations to the test's report and fails on the blocking ones, naming each with its elements. */
  async finish(name: string): Promise<void> {
    const report = JSON.stringify({ states: this.states.length, blocking: this.blocking, lesser: this.lesser, all: this.violations }, null, 2);
    await test.info().attach(`axe-${name}`, { body: report, contentType: 'application/json' });
    // RWAT_A11Y_OUT=<path prefix> also writes the report to a file, for reading outside the HTML report
    if (process.env.RWAT_A11Y_OUT) writeFileSync(`${process.env.RWAT_A11Y_OUT}-${name}.json`, report);
    expect(
      this.blocking.map((found) => `${found.state}: ${found.rule} (${found.impact}) ${found.nodes.join(' | ')}`),
      'axe: serious and critical violations',
    ).toEqual([]);
  }
}
