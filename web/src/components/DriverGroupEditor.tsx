import { ActionIcon, Alert, Button, Card, Group, Modal, MultiSelect, Radio, Select, Stack, Switch, TagsInput, Text, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconPlus, IconX } from '@tabler/icons-react'
import { useState } from 'react'
import { useAddDriverGroup, useChangeDriverGroup } from '../api/queries'
import type { DriverGroup, DriverGroupFilter } from '../api/types'
import { chassisTypes, filterTypes } from '../lib/drivers'
import { DialogForm } from './DialogForm'

interface DriverGroupEditorProps {
  opened: boolean
  /** The group to change; null to create one. */
  group: DriverGroup | null
  /** The names in use, to catch a clash before WDS does. */
  names: string[]
  onClose: () => void
}

/** Creates a driver group, or changes one's name, state, applicability and filters. */
export function DriverGroupEditor({ opened, group, names, onClose }: DriverGroupEditorProps) {
  return (
    <Modal opened={opened} onClose={onClose} size="xl" title={group ? `Change ${group.name}` : 'New driver group'} closeOnClickOutside={false}>
      {/* Mounted only while open, so each opening starts from the group as it is now. */}
      {opened && <GroupForm group={group} names={names} onDone={onClose} />}
    </Modal>
  )
}

const sameFilters = (a: DriverGroupFilter[], b: DriverGroupFilter[]) =>
  a.length === b.length &&
  a.every((f) =>
    b.some(
      (g) =>
        g.type === f.type &&
        g.policy === f.policy &&
        g.values.length === f.values.length &&
        g.values.every((v) => f.values.some((w) => w.toLowerCase() === v.toLowerCase())),
    ),
  )

function GroupForm({ group, names, onDone }: { group: DriverGroup | null; names: string[]; onDone: () => void }) {
  const add = useAddDriverGroup()
  const change = useChangeDriverGroup()
  const error = add.error ?? change.error
  const [name, setName] = useState(group?.name ?? '')
  const [enabled, setEnabled] = useState(group?.enabled ?? true)
  const [applicability, setApplicability] = useState(group?.applicability === 'All' ? 'All' : 'Matched')
  const [filters, setFilters] = useState<DriverGroupFilter[]>(group?.filters ?? [])

  const trimmed = name.trim()
  const clash = names.some((n) => n.toLowerCase() === trimmed.toLowerCase() && n !== group?.name)
  const emptyFilter = filters.some((f) => f.values.length === 0)
  const unused = filterTypes.filter((t) => !filters.some((f) => f.type === t.value))

  const setFilter = (index: number, filter: DriverGroupFilter) => setFilters(filters.map((f, i) => (i === index ? filter : f)))

  const changes = group && {
    name: trimmed !== group.name ? trimmed : null,
    enabled: enabled !== group.enabled ? enabled : null,
    applicability: applicability !== (group.applicability ?? 'Matched') ? applicability : null,
    filters: sameFilters(filters, group.filters) ? null : filters,
  }
  const ready = trimmed.length > 0 && !clash && !emptyFilter && (!changes || Object.values(changes).some((v) => v !== null))

  const save = async () => {
    try {
      if (group && changes) {
        await change.mutateAsync({ name: group.name, changes })
        notifications.show({ color: 'green', message: `Saved ${trimmed}` })
      } else {
        await add.mutateAsync({ name: trimmed, enabled, applicability: applicability as 'Matched' | 'All', filters })
        notifications.show({ color: 'green', message: `Created ${trimmed}` })
      }
      onDone()
    } catch {
      // Shown from the mutation's error.
    }
  }

  return (
    <DialogForm onSubmit={() => void save()} canSubmit={ready}>
      <TextInput
        label="Name"
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
        error={clash ? 'There’s a driver group with that name already.' : null}
        required
        data-autofocus
      />
      <Switch
        label="Enabled"
        description="A disabled group gives no client its drivers."
        checked={enabled}
        onChange={(event) => setEnabled(event.currentTarget.checked)}
      />
      <Radio.Group label="Which of its packages a client gets" value={applicability} onChange={setApplicability}>
        <Stack gap="xs" mt="xs">
          <Radio value="Matched" label="The ones that match the client's hardware" description="Usual for a group of drivers for many devices." />
          <Radio value="All" label="All of them" description="For drivers Windows needs but the hardware doesn't ask for, such as a printer's." />
        </Stack>
      </Radio.Group>

      <div>
        <Text size="sm" fw={500}>
          Filters
        </Text>
        <Text size="xs" c="dimmed" mb="xs">
          A client gets the group's drivers only if it matches every filter (any of a filter's values). With no filters, every client does.
        </Text>
        <Stack gap="xs">
          {filters.map((filter, index) => {
            const type = filterTypes.find((t) => t.value === filter.type)
            const choices = filterTypes.filter((t) => t.value === filter.type || !filters.some((f) => f.type === t.value))
            return (
              <Card key={filter.type} withBorder padding="sm">
                <Group align="flex-start" wrap="nowrap" gap="sm">
                  <Select
                    data={choices.map((t) => ({ value: t.value, label: t.label }))}
                    value={filter.type}
                    onChange={(value) => value && setFilter(index, { type: value, policy: filter.policy, values: [] })}
                    allowDeselect={false}
                    w={170}
                    comboboxProps={{ withinPortal: true }}
                    aria-label="Filter"
                  />
                  <Select
                    data={[
                      { value: 'Include', label: 'is' },
                      { value: 'Exclude', label: 'isn’t' },
                    ]}
                    value={filter.policy}
                    onChange={(value) => value && setFilter(index, { ...filter, policy: value as 'Include' | 'Exclude' })}
                    allowDeselect={false}
                    w={90}
                    comboboxProps={{ withinPortal: true }}
                    aria-label="Include or exclude"
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {filter.type === 'ChassisType' ? (
                      <MultiSelect
                        data={chassisTypes}
                        value={filter.values}
                        onChange={(values) => setFilter(index, { ...filter, values })}
                        placeholder={filter.values.length === 0 ? 'Choose chassis types' : undefined}
                        comboboxProps={{ withinPortal: true }}
                        aria-label="Chassis types"
                      />
                    ) : (
                      <TagsInput
                        value={filter.values}
                        onChange={(values) => setFilter(index, { ...filter, values })}
                        placeholder={filter.values.length === 0 ? 'Type a value and press Enter' : undefined}
                        splitChars={[]}
                        aria-label="Values"
                      />
                    )}
                    {type && (
                      <Text size="xs" c="dimmed" mt={4}>
                        {type.hint}
                      </Text>
                    )}
                  </div>
                  <ActionIcon variant="subtle" color="gray" mt={4} onClick={() => setFilters(filters.filter((_, i) => i !== index))} aria-label="Remove this filter">
                    <IconX size={16} />
                  </ActionIcon>
                </Group>
              </Card>
            )
          })}
          {unused.length > 0 && (
            <Group>
              <Button
                variant="light"
                size="xs"
                leftSection={<IconPlus size={14} />}
                onClick={() => setFilters([...filters, { type: unused[0].value, policy: 'Include', values: [] }])}
              >
                Add a filter
              </Button>
            </Group>
          )}
        </Stack>
      </div>

      {emptyFilter && (
        <Text size="xs" c="dimmed">
          Give every filter at least one value, or remove it.
        </Text>
      )}
      {error && (
        <Alert color="red" icon={<IconAlertTriangle />}>
          {error.message}
        </Alert>
      )}
      <Group justify="flex-end">
        <Button variant="default" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={add.isPending || change.isPending} disabled={!ready}>
          {group ? 'Save' : 'Create'}
        </Button>
      </Group>
    </DialogForm>
  )
}
