'use client';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WINDOW_LABEL, type WindowId } from '@/lib/api';

export function WindowTabs({ windows, value, onChange }: { windows: WindowId[]; value: WindowId; onChange: (w: WindowId) => void }) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as WindowId)}>
      <TabsList aria-label="History window">
        {windows.map((w) => (
          <TabsTrigger key={w} value={w} className="px-3">
            {WINDOW_LABEL[w]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
