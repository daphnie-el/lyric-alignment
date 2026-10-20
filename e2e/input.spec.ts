import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/track', route => route.fulfill({ status: 503 }));
  await page.goto('/');
  await page.evaluate(async () => {
    const reactPath = '/node_modules/.vite/deps/react.js';
    const domPath = '/node_modules/.vite/deps/react-dom_client.js';
    const inputPath = '/src/components/Input.tsx';
    const [{ default: React }, { default: { createRoot } }, { Input }] = await Promise.all([
      import(reactPath), import(domPath), import(inputPath),
    ]);
    const container = document.createElement('div');
    document.body.append(container);

    function Inputs() {
      const [value, setValue] = React.useState('');
      return React.createElement('div', null,
        React.createElement(Input, { 'aria-label': 'General input' }),
        React.createElement(Input, {
          'aria-label': 'Timing', numbersOnly: true,
          defaultValue: '024120',
        }),
        React.createElement(Input, {
          'aria-label': 'Controlled timing', numbersOnly: true, value,
          onChange: (event: Event) => setValue((event.target as HTMLInputElement).value),
        }),
        React.createElement(Input, {
          'aria-label': 'Invalid timing', error: 'Enter a valid timing.',
          'aria-describedby': 'timing-hint',
        }),
        React.createElement('span', { id: 'timing-hint' }, 'Timing hint'),
      );
    }

    createRoot(container).render(React.createElement(Inputs));
  });
});

test('general input accepts text and exposes accessible errors', async ({ page }) => {
  const general = page.getByRole('textbox', { name: 'General input', exact: true });
  await general.fill('Lyrics 123');
  await expect(general).toHaveValue('Lyrics 123');
  await expect(general).not.toHaveAttribute('aria-invalid');

  const invalid = page.getByRole('textbox', { name: 'Invalid timing', exact: true });
  await expect(invalid).toHaveAttribute('aria-invalid', 'true');
  await expect(invalid).toHaveAccessibleDescription('Timing hint Enter a valid timing.');
  await expect(page.getByRole('alert').filter({ hasText: 'Enter a valid timing.' })).toBeVisible();
});

test('numbersOnly handles typing, pasted text, clearing and deletion', async ({ page }) => {
  const timing = page.getByRole('textbox', { name: 'Timing', exact: true });
  await expect(timing).toHaveValue('024120');
  await expect(timing).toHaveAttribute('inputmode', 'decimal');
  await timing.fill('abc0.24120xyz');
  await expect(timing).toHaveValue('0.24120');
  await timing.fill('');
  await expect(timing).toHaveValue('');
  await timing.pressSequentially('0.24120abc');
  await expect(timing).toHaveValue('0.24120');
  await timing.evaluate((input: HTMLInputElement) => input.setSelectionRange(3, 3));
  await timing.press('Backspace');
  await expect(timing).toHaveValue('0.4120');
  await timing.fill('12345678');
  await expect(timing).toHaveValue('12345678');

  const controlled = page.getByRole('textbox', { name: 'Controlled timing', exact: true });
  await controlled.pressSequentially('24.120abc');
  await expect(controlled).toHaveValue('24.120');
  await controlled.fill('');
  await expect(controlled).toHaveValue('');
});
