/**
 * Reusable text filter for any list of DOM items.
 *
 * Creates an <input type="search"> and attaches it to a container element.
 * As the user types, list items that don't match are hidden (display: none).
 */

export interface ListFilterOptions {
  /** The container element to insert the search input into (e.g., a header bar). */
  container: HTMLElement;

  /** The list element whose direct children will be filtered. */
  list: HTMLElement;

  /** Placeholder text shown in the input. Defaults to "Filter". */
  placeholder?: string;

  /** Accessible label for screen readers. Defaults to placeholder value. */
  ariaLabel?: string;

  /**
   * Extract searchable text from a list item.
   * Defaults to `(el) => el.textContent ?? ''`.
   */
  getText?: (item: HTMLElement) => string;

  /** If provided, insert the input before this element instead of appending. */
  insertBefore?: HTMLElement;
}

export class ListFilter {
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly getText: (item: HTMLElement) => string;

  constructor(opts: ListFilterOptions) {
    this.list = opts.list;
    this.getText = opts.getText ?? ((el) => el.textContent ?? '');

    this.input = document.createElement('input');
    this.input.type = 'search';
    this.input.className = 'list-filter-input';
    this.input.placeholder = opts.placeholder ?? 'Filter';
    this.input.setAttribute('aria-label', opts.ariaLabel ?? opts.placeholder ?? 'Filter');
    this.input.autocomplete = 'off';

    if (opts.insertBefore) {
      opts.container.insertBefore(this.input, opts.insertBefore);
    } else {
      opts.container.appendChild(this.input);
    }

    this.input.addEventListener('input', () => this.applyFilter());
    // WebKit fires 'search' (not always 'input') when the native clear button is clicked
    this.input.addEventListener('search', () => this.applyFilter());

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
      if (e.key === 'Escape' && this.input.value) {
        e.stopPropagation();
        this.clear();
      }
    });
  }

  /** Re-apply the current filter query against list items. Call after list re-render. */
  applyFilter(): void {
    const query = this.input.value.toLowerCase().trim();
    const items = this.list.children;

    for (let i = 0; i < items.length; i++) {
      const item = items[i] as HTMLElement;
      if (!query) {
        item.style.removeProperty('display');
      } else {
        const text = this.getText(item).toLowerCase();
        item.style.display = text.includes(query) ? '' : 'none';
      }
    }
  }

  /** Clear the filter and show all items. */
  clear(): void {
    this.input.value = '';
    this.applyFilter();
  }
}
