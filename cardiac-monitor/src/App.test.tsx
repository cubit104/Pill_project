import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

test('renders CardiaVue homepage', () => {
  render(<App />);
  const titleElement = screen.getByText(/CardiaVue/i);
  expect(titleElement).toBeInTheDocument();
});
