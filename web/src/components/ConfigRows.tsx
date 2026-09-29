import { Group, Text } from '@mantine/core'
import { Fragment } from 'react'
import type { WdsUtilNode } from '../api/types'

/** WDSUTIL's report lines as label/value rows, indented the way WDSUTIL nests them. */
export function ConfigRows({ nodes, depth = 0 }: { nodes: WdsUtilNode[]; depth?: number }) {
  return (
    <>
      {nodes.map((node, index) => (
        <Fragment key={`${index}-${node.name}`}>
          <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md" py={3} pl={depth * 16}>
            <Text size="sm" c={node.children.length ? undefined : 'dimmed'} fw={node.children.length ? 500 : 400}>
              {node.name}
            </Text>
            {node.value !== null && (
              <Text size="sm" ta="right" style={{ wordBreak: 'break-word' }}>
                {node.value}
              </Text>
            )}
          </Group>
          {node.children.length > 0 && <ConfigRows nodes={node.children} depth={depth + 1} />}
        </Fragment>
      ))}
    </>
  )
}
