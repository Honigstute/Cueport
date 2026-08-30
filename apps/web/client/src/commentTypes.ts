export interface CommentAuthor {
  id: string | null
  displayName: string
  title: string
  avatarUrl: string | null
}

export interface DiscussionComment {
  id: string
  body: string
  createdAt: string
  updatedAt: string
  edited: boolean
  canEdit: boolean
  canDelete: boolean
  author: CommentAuthor
}

export interface DiscussionThread {
  id: string
  slideId: string
  x: number
  y: number
  createdAt: string
  updatedAt: string
  canDelete: boolean
  comments: DiscussionComment[]
}
