import { Box, Button, HStack, Input, NativeSelect, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { FiPlus, FiRotateCcw, FiTrash2 } from "react-icons/fi";

const blankInventory = (availability) => ({
  store_id: "",
  size: null,
  availability: availability || "in stock",
  inventory_qty: 0,
  metadata: {},
});

function FieldError({ message }) {
  return message ? <Text className="field-error">{message}</Text> : null;
}

export default function ProductInventoryEditor({
  inventory = [],
  stores = [],
  availability = [],
  referencesReady = true,
  errors = {},
  onChange,
}) {
  const [removed, setRemoved] = useState(null);
  const storesById = useMemo(() => new Map(stores.map((store) => [store.id, store])), [stores]);

  const updateRow = (index, field, value) => {
    onChange?.(inventory.map((row, rowIndex) => (
      rowIndex === index ? { ...row, [field]: value } : row
    )));
  };

  const removeRow = (index) => {
    if (inventory.length <= 1) return;
    setRemoved({ row: inventory[index], index });
    onChange?.(inventory.filter((_, rowIndex) => rowIndex !== index));
  };

  const undoRemove = () => {
    if (!removed) return;
    const next = [...inventory];
    next.splice(Math.min(removed.index, next.length), 0, removed.row);
    onChange?.(next);
    setRemoved(null);
  };

  const defaultAvailability = availability[0]?.id || "in stock";

  return (
    <Box className="editor-section product-inventory-editor">
      <HStack justify="space-between" gap={3} align="start" flexWrap="wrap" mb={4}>
        <Box>
          <Text className="panel-title">Store inventory</Text>
          <Text className="muted-text">Availability belongs to this product at a named store. Size is optional.</Text>
        </Box>
        <Button type="button" size="sm" className="secondary-button" disabled={!referencesReady} onClick={() => onChange?.([...inventory, blankInventory(defaultAvailability)])}>
          <FiPlus /> Add inventory row
        </Button>
      </HStack>

      {removed ? (
        <HStack className="catalog-undo-bar" justify="space-between" gap={3} mb={3}>
          <Text>Inventory row removed from this draft.</Text>
          <Button type="button" size="sm" variant="ghost" onClick={undoRemove}><FiRotateCcw /> Undo</Button>
        </HStack>
      ) : null}

      <VStack align="stretch" gap={3}>
        {inventory.map((row, index) => {
          const currentStore = storesById.get(row.store_id);
          const storeLabel = currentStore?.label || row.store_id || `row ${index + 1}`;
          return (
            <SimpleGrid key={index} columns={{ base: 1, md: 2, xl: 5 }} gap={3} className="catalog-inventory-row">
              <Box>
                <Text className="filter-label">Store</Text>
                <NativeSelect.Root>
                  <NativeSelect.Field aria-label={`Inventory ${index + 1} store`} value={row.store_id} onChange={(event) => updateRow(index, "store_id", event.target.value)} disabled={!referencesReady} className="native-select">
                    {!row.store_id ? <option value="">Select a store</option> : null}
                    {row.store_id && !currentStore ? <option value={row.store_id}>Unknown store ({row.store_id})</option> : null}
                    {stores.map((store) => <option key={store.id} value={store.id}>{store.label}</option>)}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
                <FieldError message={errors[`inventory.${index}.store_id`]} />
              </Box>
              <Box>
                <Text className="filter-label">Optional size</Text>
                <Input aria-label={`Inventory ${index + 1} size`} value={row.size || ""} onChange={(event) => updateRow(index, "size", event.target.value || null)} placeholder="One size" maxLength={64} />
                <FieldError message={errors[`inventory.${index}.size`]} />
              </Box>
              <Box>
                <Text className="filter-label">Availability</Text>
                <NativeSelect.Root>
                  <NativeSelect.Field aria-label={`Inventory ${index + 1} availability`} value={row.availability} onChange={(event) => updateRow(index, "availability", event.target.value)} disabled={!referencesReady} className="native-select">
                    {row.availability && !availability.some((item) => item.id === row.availability) ? <option value={row.availability}>{row.availability}</option> : null}
                    {availability.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
                <FieldError message={errors[`inventory.${index}.availability`]} />
              </Box>
              <Box>
                <Text className="filter-label">Quantity</Text>
                <Input aria-label={`Inventory ${index + 1} quantity`} type="number" min="0" step="1" value={row.inventory_qty} onChange={(event) => updateRow(index, "inventory_qty", event.target.value)} />
                <FieldError message={errors[`inventory.${index}.inventory_qty`]} />
              </Box>
              <Button type="button" size="sm" variant="ghost" alignSelf="end" className="danger-button" disabled={inventory.length <= 1} aria-label={`Remove inventory for ${storeLabel}`} onClick={() => removeRow(index)}>
                <FiTrash2 /> Remove
              </Button>
            </SimpleGrid>
          );
        })}
      </VStack>
      {!referencesReady ? <Text className="catalog-action-hint">Store and availability choices must load before inventory rows can be added.</Text> : null}
    </Box>
  );
}
