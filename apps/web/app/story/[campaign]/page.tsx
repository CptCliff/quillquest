'use client';
import { use } from 'react';
import { Workspace } from '../../../components/Workspace';

export default function StoryPage({ params }: { params: Promise<{ campaign: string }> }) {
  const { campaign } = use(params);
  return <Workspace campaign={campaign} />;
}
