import {
  Alert,
  Button,
  Code,
  FileButton,
  Group,
  Loader,
  Modal,
  NumberInput,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconFileUpload } from '@tabler/icons-react'
import { useState } from 'react'
import { useImageUnattend, useSetImageProperties, type ImageChanges, type ImageRef } from '../api/queries'
import type { ImageKind, ImageUnattend, WdsRecord } from '../api/types'
import { asNumber, asString } from '../lib/records'

const DEFAULT_ORDER = 500000
const UNATTEND_NAMESPACE = 'urn:schemas-microsoft-com:unattend'

interface ImagePropertiesDialogProps {
  kind: ImageKind
  image: WdsRecord
  opened: boolean
  onClose: () => void
}

/** Renames an image or changes its description and display order, and an install image's unattend file. */
export function ImagePropertiesDialog({ kind, image, opened, onClose }: ImagePropertiesDialogProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={`${String(image.Name)}: properties`} size="xl">
      {/* Mounted only while open, so each opening starts from the image as it is now. */}
      {opened && <PropertiesForm kind={kind} image={image} onDone={onClose} />}
    </Modal>
  )
}

function PropertiesForm({ kind, image, onDone }: { kind: ImageKind; image: WdsRecord; onDone: () => void }) {
  const save = useSetImageProperties()
  const name = String(image.Name)
  const ref: ImageRef =
    kind === 'boot'
      ? { name, architecture: String(image.Architecture), fileName: asString(image.FileName) }
      : { name, imageGroup: asString(image.ImageGroup), fileName: asString(image.FileName) }
  const unattend = useImageUnattend(kind === 'install' ? ref : null)

  const initialDescription = asString(image.Description) ?? ''
  const initialOrder = asNumber(image.DisplayOrder) ?? DEFAULT_ORDER
  const [newName, setNewName] = useState(name)
  const [description, setDescription] = useState(initialDescription)
  const [order, setOrder] = useState<number | string>(initialOrder)
  const [unattendMode, setUnattendMode] = useState<UnattendMode>('keep')
  const [unattendXml, setUnattendXml] = useState<string | null>(null)

  const editedXml = unattendXml ?? unattend.data?.content ?? ''
  const xmlProblem = unattendMode === 'replace' ? unattendProblem(editedXml) : null
  const changes: ImageChanges = {
    newName: newName.trim() && newName.trim() !== name ? newName.trim() : null,
    newDescription: description.trim() && description.trim() !== initialDescription ? description.trim() : null,
    displayOrder: typeof order === 'number' && order !== initialOrder ? order : null,
    unattendXml: unattendMode === 'replace' && editedXml !== (unattend.data?.content ?? '') ? editedXml : null,
    removeUnattend: unattendMode === 'remove',
  }
  const changed =
    changes.newName !== null || changes.newDescription !== null || changes.displayOrder !== null || changes.unattendXml !== null || changes.removeUnattend

  const submit = async () => {
    try {
      await save.mutateAsync({ kind, image: ref, changes })
      notifications.show({ color: 'green', message: `Saved ${changes.newName ?? name}` })
      onDone()
    } catch {
      // Shown from the mutation's error.
    }
  }

  return (
    <Stack>
      <TextInput label="Name" value={newName} onChange={(e) => setNewName(e.currentTarget.value)} maxLength={128} />
      <TextInput
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.currentTarget.value)}
        maxLength={512}
        description={kind === 'boot' ? 'Shown in the boot menu.' : 'Shown when choosing an image in the WDS client.'}
      />
      <NumberInput
        label="Display order"
        value={order}
        onChange={setOrder}
        min={0}
        max={9_999_999}
        allowDecimal={false}
        thousandSeparator=","
        description={`WDS lists ${kind === 'boot' ? 'boot images' : 'images'} with lower numbers first. The default is 500,000.`}
        w={260}
      />
      {kind === 'install' && (
        <UnattendSection
          unattend={unattend.data}
          loading={unattend.isPending}
          error={unattend.error}
          mode={unattendMode}
          onModeChange={setUnattendMode}
          xml={editedXml}
          onXmlChange={setUnattendXml}
          problem={xmlProblem}
        />
      )}
      {save.error && (
        <Alert color="red" icon={<IconAlertTriangle />}>
          {save.error.message}
        </Alert>
      )}
      <Group justify="flex-end">
        <Button variant="default" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={submit} loading={save.isPending} disabled={!changed || !!xmlProblem}>
          Save
        </Button>
      </Group>
    </Stack>
  )
}

type UnattendMode = 'keep' | 'replace' | 'remove'

interface UnattendSectionProps {
  unattend: ImageUnattend | undefined
  loading: boolean
  error: Error | null
  mode: UnattendMode
  onModeChange: (mode: UnattendMode) => void
  xml: string
  onXmlChange: (xml: string) => void
  problem: string | null
}

function UnattendSection({ unattend, loading, error, mode, onModeChange, xml, onXmlChange, problem }: UnattendSectionProps) {
  if (loading) {
    return (
      <Group gap="xs">
        <Loader size="xs" />
        <Text size="sm" c="dimmed">
          Reading the image's unattend file…
        </Text>
      </Group>
    )
  }
  if (error || !unattend) {
    return (
      <Alert color="yellow" icon={<IconAlertTriangle />} title="Couldn't read the unattend file">
        {error?.message}
      </Alert>
    )
  }

  const load = async (file: File | null) => {
    if (file) onXmlChange(await file.text())
  }

  return (
    <Stack gap="xs">
      <div>
        <Text size="sm" fw={500}>
          Unattend file
        </Text>
        <Text size="xs" c="dimmed">
          {unattend.present
            ? 'Windows Setup takes its answers from this file when it installs the image.'
            : "None: Windows Setup asks its questions, unless the WDS client's unattend file answers them."}{' '}
          WDS keeps it at <Code>{unattend.path}</Code>.
        </Text>
      </div>
      <SegmentedControl
        value={mode}
        onChange={(value) => onModeChange(value as UnattendMode)}
        data={
          unattend.present
            ? [
                { value: 'keep', label: 'Keep' },
                { value: 'replace', label: 'Edit' },
                { value: 'remove', label: 'Remove' },
              ]
            : [
                { value: 'keep', label: 'None' },
                { value: 'replace', label: 'Add' },
              ]
        }
        w="fit-content"
      />
      {mode === 'keep' && unattend.content && (
        <Textarea value={unattend.content} readOnly autosize minRows={6} maxRows={18} styles={monospace} />
      )}
      {mode === 'replace' && (
        <>
          <Group gap="xs">
            <FileButton onChange={load} accept=".xml,text/xml,application/xml">
              {(props) => (
                <Button {...props} size="xs" variant="default" leftSection={<IconFileUpload size={14} />}>
                  Load from a file…
                </Button>
              )}
            </FileButton>
            <Text size="xs" c="dimmed">
              Or paste it below. It's checked before it's saved.
            </Text>
          </Group>
          <Textarea
            value={xml}
            onChange={(e) => onXmlChange(e.currentTarget.value)}
            autosize
            minRows={10}
            maxRows={24}
            styles={monospace}
            error={problem}
            placeholder={`<?xml version="1.0" encoding="utf-8"?>\n<unattend xmlns="${UNATTEND_NAMESPACE}">\n  …\n</unattend>`}
            spellCheck={false}
          />
        </>
      )}
      {mode === 'remove' && (
        <Text size="sm">Saving deletes the file, so Windows Setup asks its questions again when it installs this image.</Text>
      )}
    </Stack>
  )
}

const monospace = { input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 'var(--mantine-font-size-xs)' } }

/** The same check the server makes, for quick feedback: XML whose root is Setup's unattend element. */
function unattendProblem(xml: string): string | null {
  if (!xml.trim()) return 'Paste or load an unattend file.'
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.getElementsByTagName('parsererror').length > 0) return "This isn't valid XML."
  const root = document.documentElement
  if (root.localName !== 'unattend' || root.namespaceURI !== UNATTEND_NAMESPACE)
    return `The root element must be <unattend xmlns="${UNATTEND_NAMESPACE}">.`
  return null
}
