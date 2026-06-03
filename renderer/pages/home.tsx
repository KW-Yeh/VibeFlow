import React from 'react'
import Head from 'next/head'

import { KanbanBoard } from '@/components/kanban-board'

export default function HomePage() {
  return (
    <React.Fragment>
      <Head>
        <title>VibeFlow</title>
      </Head>
      <div className="dark">
        <KanbanBoard />
      </div>
    </React.Fragment>
  )
}
