'use client';

import { useState, useCallback } from 'react';

interface FilterValues {
  linha_produto: string;
  molde: string;
  forma_frete: string;
  busca: string;
}

interface FilterBarProps {
  filters: FilterValues;
  onFilterChange: (filters: FilterValues) => void;
}

const PRODUCT_LINES = [
  { value: '', label: 'Todas as linhas' },
  { value: 'uniquebox', label: 'UniqueBox' },
  { value: 'uniquekids', label: 'UniqueKids' },
];

const MOLDS = [
  { value: '', label: 'Todos os moldes' },
  { value: 'NM AV', label: 'NM AV' },
  { value: 'NNA', label: 'NNA' },
  { value: 'PD', label: 'PD' },
  { value: 'TD', label: 'TD' },
  { value: 'NNA CP', label: 'NNA CP' },
  { value: 'NM AV CP', label: 'NM AV CP' },
];

const SHIPPING = [
  { value: '', label: 'Todos os fretes' },
  { value: 'Correios', label: 'Correios' },
  { value: 'Loggi', label: 'Loggi' },
  { value: 'Jadlog', label: 'Jadlog' },
  { value: 'Braspress', label: 'Braspress' },
  { value: 'Retirada', label: 'Retirada' },
];

export default function FilterBar({ filters, onFilterChange }: FilterBarProps) {
  const [searchInput, setSearchInput] = useState(filters.busca);

  const update = useCallback(
    (key: keyof FilterValues, value: string) => {
      onFilterChange({ ...filters, [key]: value });
    },
    [filters, onFilterChange]
  );

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      update('busca', searchInput);
    }
  };

  return (
    <div className="flex flex-wrap gap-3 items-center">
      <select
        value={filters.linha_produto}
        onChange={(e) => update('linha_produto', e.target.value)}
        className="px-3 py-2 border rounded-md text-sm bg-white"
      >
        {PRODUCT_LINES.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <select
        value={filters.molde}
        onChange={(e) => update('molde', e.target.value)}
        className="px-3 py-2 border rounded-md text-sm bg-white"
      >
        {MOLDS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <select
        value={filters.forma_frete}
        onChange={(e) => update('forma_frete', e.target.value)}
        className="px-3 py-2 border rounded-md text-sm bg-white"
      >
        {SHIPPING.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <div className="relative">
        <input
          type="text"
          placeholder="Buscar cliente ou NF..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          className="px-3 py-2 border rounded-md text-sm w-56"
        />
        <button
          onClick={() => update('busca', searchInput)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
