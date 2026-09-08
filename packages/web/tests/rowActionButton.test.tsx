// Regression tests for the shared Dashboard row edit/delete action button
// (packages/unified-app/src/components/RowActionButton.tsx), introduced to
// replace tiny bare-emoji buttons in the Dashboard drill-down tables (admin +
// scheduling) with a larger, clearer, accessible control. No React Testing
// Library is installed in this project, so these render with plain
// react-dom/client + act, matching the pattern used by routing.test.tsx.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import fs from 'fs';
import path from 'path';
import RowActionButton from '../../unified-app/src/components/RowActionButton';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) { act(() => { root!.unmount(); }); root = null; }
  if (container) { container.remove(); container = null; }
});

function render(ui: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(ui); });
  return container;
}

describe('RowActionButton', () => {
  it('edit variant invokes the provided onClick when clicked', () => {
    const onClick = vi.fn();
    const el = render(<RowActionButton variant="edit" onClick={onClick} title="Edit" />);
    const button = el.querySelector('button')!;
    act(() => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('delete variant invokes the provided onClick when clicked', () => {
    const onClick = vi.fn();
    const el = render(<RowActionButton variant="delete" onClick={onClick} title="Delete" />);
    const button = el.querySelector('button')!;
    act(() => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders both an edit and a delete control together, each independently clickable', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const el = render(
      <div>
        <RowActionButton variant="edit" onClick={onEdit} title="Edit" />
        <RowActionButton variant="delete" onClick={onDelete} title="Delete" />
      </div>
    );
    const buttons = el.querySelectorAll('button');
    expect(buttons.length).toBe(2);
    act(() => { buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
    act(() => { buttons[1].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('exposes an accessible title/aria-label matching the passed title, and a comfortable click target', () => {
    const el = render(<RowActionButton variant="delete" onClick={() => {}} title="Delete record" />);
    const button = el.querySelector('button')!;
    expect(button.getAttribute('title')).toBe('Delete record');
    expect(button.getAttribute('aria-label')).toBe('Delete record');
    // The target is now the shared control-height token rather than a fixed
    // 36px, so it tracks the user's Interface Scale setting (28/32/36px)
    // and matches every other control sitting in the same table row.
    expect(button.className).toContain('w-control');
    expect(button.className).toContain('h-control');
    expect(button.className).not.toContain('w-6');
  });

  it('renders edit neutrally and delete destructively; the deprecated per-department theme no longer changes styling', () => {
    const edit = render(<RowActionButton variant="edit" onClick={() => {}} title="Edit" />).querySelector('button')!;
    const editClass = edit.className;
    // An edit is an ordinary action: neutral until hovered.
    expect(editClass).toContain('text-fg-muted');
    expect(editClass).not.toContain('danger');
    if (root) { act(() => { root!.unmount(); }); root = null; }
    if (container) { container.remove(); container = null; }

    // Departments share one palette now, so `theme` is inert -- passing it
    // must produce exactly the same classes as omitting it.
    const themedEdit = render(<RowActionButton variant="edit" theme="green" onClick={() => {}} title="Edit" />).querySelector('button')!;
    expect(themedEdit.className).toBe(editClass);
    if (root) { act(() => { root!.unmount(); }); root = null; }
    if (container) { container.remove(); container = null; }

    // Delete still reads as destructive, and still ignores `theme`.
    const deleteBtn = render(<RowActionButton variant="delete" theme="green" onClick={() => {}} title="Delete" />).querySelector('button')!;
    expect(deleteBtn.className).toContain('hover:bg-danger-bg');
    expect(deleteBtn.className).toContain('hover:text-danger-fg');
  });
});

// Source-level checks: confirm the Dashboard files actually wire the new
// component in for the rows this task targeted, and confirm scheduling's
// existing permission difference (no delete action on its Dashboard
// drill-down rows) was not altered by this purely visual change.
describe('Dashboard drill-down tables use RowActionButton', () => {
  const adminSrc = fs.readFileSync(
    path.resolve(__dirname, '../../unified-app/src/admin/pages/Dashboard.tsx'), 'utf-8'
  );
  const schedSrc = fs.readFileSync(
    path.resolve(__dirname, '../../unified-app/src/scheduling/pages/Dashboard.tsx'), 'utf-8'
  );

  it('admin Dashboard renders edit and delete RowActionButtons for appointment rows', () => {
    expect(adminSrc).toMatch(/<RowActionButton variant="edit" onClick=\{\(\) => setEditingAppt\(a\)\}/);
    expect(adminSrc).toMatch(/<RowActionButton variant="delete" onClick=\{\(\) => setConfirmDelete\(\{ id: a\.id, type: "appointment" \}\)\}/);
  });

  it('admin Dashboard renders a delete RowActionButton for customer rows', () => {
    expect(adminSrc).toMatch(/<RowActionButton variant="delete" onClick=\{\(\) => setConfirmDelete\(\{ id: c\.id, type: "customer" \}\)\}/);
  });

  it('scheduling Dashboard renders an edit RowActionButton for appointment rows', () => {
    // The green department theme is gone -- one palette across departments.
    expect(schedSrc).toMatch(/<RowActionButton variant="edit" onClick=\{\(\) => setEditingAppt\(a\)\}/);
    expect(schedSrc).not.toMatch(/theme="green"/);
  });

  it('scheduling Dashboard still has no delete action on drill-down rows (permissions/visibility unchanged)', () => {
    expect(schedSrc).not.toMatch(/variant="delete"/);
    expect(schedSrc).not.toMatch(/setConfirmDelete/);
  });
});
