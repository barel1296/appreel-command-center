import { Compass } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, EmptyState } from '@/components/ui'

export function NotFound() {
  const navigate = useNavigate()
  return (
    <Card className="mt-8 animate-fade-in">
      <EmptyState
        icon={<Compass size={22} />}
        title="Page not found"
        message="This route doesn't exist in the Command Center. Use the navigation or head back to the daily operating view."
        action={<Button variant="primary" onClick={() => navigate('/')}>Go to Command Center</Button>}
      />
    </Card>
  )
}
