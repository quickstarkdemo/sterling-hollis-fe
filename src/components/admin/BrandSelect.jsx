import { Box, Button, CloseButton, Dialog, HStack, Input, NativeSelect, Portal, Text, VStack } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { FiPlus, FiRefreshCw, FiSearch } from "react-icons/fi";

const normalizedName = (value) => String(value || "").trim().toLocaleLowerCase().replace(/\s+/g, " ");

function errorMessage(error) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((item) => item.msg).filter(Boolean).join(" ");
  return "The brand could not be added. Try again.";
}

export default function BrandSelect({
  brandId = "",
  brandName = "",
  brands = [],
  status = "ready",
  error,
  onChange,
  onCreate,
  onRetry,
}) {
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newBrandName, setNewBrandName] = useState("");
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);

  const options = useMemo(() => {
    const normalizedQuery = normalizedName(query);
    const filtered = normalizedQuery
      ? brands.filter((brand) => normalizedName(brand.name).includes(normalizedQuery))
      : brands;
    if (brandId && !filtered.some((brand) => brand.id === brandId)) {
      return [{ id: brandId, name: brandName || brandId }, ...filtered];
    }
    return filtered;
  }, [brandId, brandName, brands, query]);

  const selectBrand = (event) => {
    const selected = brands.find((brand) => brand.id === event.target.value)
      || options.find((brand) => brand.id === event.target.value);
    if (selected) onChange?.(selected);
  };

  const createBrand = async (event) => {
    event.preventDefault();
    const name = newBrandName.trim();
    if (!name) {
      setCreateError("Enter a brand name.");
      return;
    }
    setCreating(true);
    setCreateError("");
    try {
      const brand = await onCreate?.(name);
      if (brand) onChange?.(brand);
      setDialogOpen(false);
      setNewBrandName("");
    } catch (nextError) {
      if (nextError?.response?.status === 409) {
        const existing = brands.find((brand) => normalizedName(brand.name) === normalizedName(name));
        if (existing) onChange?.(existing);
        setCreateError(existing
          ? `${existing.name} already exists and is now selected.`
          : "That brand already exists. Refresh references and select it.");
      } else {
        setCreateError(errorMessage(nextError));
      }
    } finally {
      setCreating(false);
    }
  };

  const updateDialogOpen = ({ open }) => {
    setDialogOpen(open);
    if (!open) {
      setNewBrandName("");
      setCreateError("");
    }
  };

  return (
    <VStack align="stretch" gap={2} className="brand-select">
      <HStack gap={2} className="catalog-search-field">
        <FiSearch aria-hidden="true" />
        <Input
          aria-label="Search brands"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search canonical brands"
          disabled={status === "loading"}
        />
      </HStack>
      <NativeSelect.Root>
        <NativeSelect.Field
          aria-label="Product brand"
          value={brandId}
          onChange={selectBrand}
          disabled={status !== "ready" || !brands.length}
          className="native-select"
        >
          {!brandId ? <option value="">Select a brand</option> : null}
          {options.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
      <HStack justify="space-between" align="start" gap={3} flexWrap="wrap">
        <Box>
          {status === "loading" ? <Text className="muted-text">Loading canonical brands…</Text> : null}
          {status === "ready" && !brands.length ? <Text className="field-error">No active brands are available.</Text> : null}
          {status === "error" ? <Text className="field-error">Brand references are unavailable. Your current value is preserved.</Text> : null}
          {error ? <Text className="field-error">{error}</Text> : null}
        </Box>
        <HStack gap={2}>
          {status === "error" ? <Button type="button" size="sm" variant="ghost" onClick={onRetry}><FiRefreshCw /> Retry</Button> : null}
          <Dialog.Root open={dialogOpen} onOpenChange={updateDialogOpen}>
            <Dialog.Trigger asChild>
              <Button type="button" size="sm" className="secondary-button" disabled={status !== "ready"}>
                <FiPlus /> Add brand
              </Button>
            </Dialog.Trigger>
            <Portal>
              <Dialog.Backdrop />
              <Dialog.Positioner>
                <Dialog.Content className="catalog-dialog">
                  <form onSubmit={createBrand}>
                    <Dialog.Header pr="52px">
                      <Box>
                        <Dialog.Title>Add a canonical brand</Dialog.Title>
                        <Dialog.Description mt={2}>Brand names are shared across the catalog and must be unique.</Dialog.Description>
                      </Box>
                    </Dialog.Header>
                    <Dialog.Body>
                      <Text as="label" htmlFor="new-catalog-brand" className="filter-label">Brand name</Text>
                      <Input
                        id="new-catalog-brand"
                        aria-label="New brand name"
                        value={newBrandName}
                        onChange={(event) => setNewBrandName(event.target.value)}
                        maxLength={128}
                        autoFocus
                      />
                      {createError ? <Text className="field-error" role="alert">{createError}</Text> : null}
                    </Dialog.Body>
                    <Dialog.Footer>
                      <Dialog.ActionTrigger asChild><Button type="button" className="secondary-button">Cancel</Button></Dialog.ActionTrigger>
                      <Button type="submit" className="primary-button" disabled={creating}>{creating ? "Adding…" : "Add brand"}</Button>
                    </Dialog.Footer>
                  </form>
                  <Dialog.CloseTrigger asChild><CloseButton size="sm" /></Dialog.CloseTrigger>
                </Dialog.Content>
              </Dialog.Positioner>
            </Portal>
          </Dialog.Root>
        </HStack>
      </HStack>
    </VStack>
  );
}
