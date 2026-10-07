'use client';
import { use } from 'react';
import { Workspace } from '../../../components/Workspace';

/** A player's private solo draft of their Origin and Life Chapters (design plan 7.1). */
export default function DraftPage({ params }: { params: Promise<{ campaign: string }> }) {
  const { campaign } = use(params);
  return <Workspace campaign={campaign} draft />;
}
