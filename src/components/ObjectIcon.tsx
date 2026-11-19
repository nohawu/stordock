import {
  Braces,
  File,
  FileArchive,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  FileType2,
} from 'lucide-react';
import { objectType } from '../lib/objects';
import type { StorageObject } from '../types';
export function ObjectIcon({
  object,
  size = 19,
  boxed = true,
}: {
  object: StorageObject;
  size?: number;
  boxed?: boolean;
}) {
  const type = objectType(object);
  const Icon =
    {
      folder: Folder,
      image: FileImage,
      code: Braces,
      archive: FileArchive,
      video: FileVideo,
      pdf: FileType2,
      text: FileText,
    }[type] || File;
  return (
    <span className={`object-icon type-${type} ${boxed ? 'boxed' : ''}`}>
      <Icon
        size={size}
        strokeWidth={1.65}
        fill={type === 'folder' ? 'currentColor' : 'none'}
        fillOpacity={type === 'folder' ? 0.16 : 1}
      />
    </span>
  );
}
