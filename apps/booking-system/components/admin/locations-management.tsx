'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import type { Location } from '@/lib/database.types';
import { Plus, Edit2, Trash2, Save, X } from 'lucide-react';

interface LocationsManagementProps {
  initialLocations: Location[];
}

interface LocationForm {
  name: string;
  address: string;
  active: boolean;
}

export function LocationsManagement({ initialLocations }: LocationsManagementProps) {
  const [locations, setLocations] = useState<Location[]>(initialLocations);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState<LocationForm>({
    name: '',
    address: '',
    active: true,
  });
  const [loading, setLoading] = useState(false);

  const resetForm = () => {
    setFormData({ name: '', address: '', active: true });
    setEditingId(null);
    setIsAdding(false);
  };

  const handleAdd = () => {
    setIsAdding(true);
    setFormData({ name: '', address: '', active: true });
  };

  const handleEdit = (location: Location) => {
    setEditingId(location.id);
    setFormData({
      name: location.name,
      address: location.address,
      active: location.active,
    });
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      if (isAdding) {
        // In a real app, this would call an API route that uses the server queries
        console.log('Creating location:', formData);
        // For now, just simulate adding to local state
        const newLocation: Location = {
          id: `temp-${Date.now()}`,
          ...formData,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        setLocations([...locations, newLocation]);
      } else if (editingId) {
        // In a real app, this would call an API route that uses the server queries
        console.log('Updating location:', editingId, formData);
        // For now, just simulate updating in local state
        setLocations(
          locations.map((loc) =>
            loc.id === editingId
              ? { ...loc, ...formData, updated_at: new Date().toISOString() }
              : loc
          )
        );
      }
      resetForm();
    } catch (error) {
      console.error('Error saving location:', error);
      // In a real app, you'd show an error toast here
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this location?')) {
      return;
    }

    setLoading(true);
    try {
      // In a real app, this would call an API route that uses the server queries
      console.log('Deleting location:', id);
      // For now, just simulate deletion from local state
      setLocations(locations.filter((loc) => loc.id !== id));
    } catch (error) {
      console.error('Error deleting location:', error);
      // In a real app, you'd show an error toast here
    } finally {
      setLoading(false);
    }
  };

  const isFormValid = formData.name.trim() && formData.address.trim();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-semibold">Locations</h2>
        <Button onClick={handleAdd} disabled={isAdding || editingId !== null}>
          <Plus className="h-4 w-4 mr-2" />
          Add Location
        </Button>
      </div>

      {(isAdding || editingId) && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle>{isAdding ? 'Add New Location' : 'Edit Location'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Downtown Wellness Center"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Address *</Label>
                <Input
                  id="address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="123 Main St, City, State 12345"
                />
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="active"
                checked={formData.active}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, active: checked as boolean })
                }
              />
              <Label htmlFor="active" className="text-sm">
                Active (visible to customers)
              </Label>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={!isFormValid || loading} className="flex-1">
                <Save className="h-4 w-4 mr-2" />
                {loading ? 'Saving...' : 'Save'}
              </Button>
              <Button variant="outline" onClick={resetForm} disabled={loading} className="flex-1">
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {locations.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <p className="text-muted-foreground">No locations found.</p>
            </CardContent>
          </Card>
        ) : (
          locations.map((location) => (
            <Card
              key={location.id}
              className={editingId === location.id ? 'ring-2 ring-primary' : ''}
            >
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{location.name}</h3>
                      <Badge variant={location.active ? 'default' : 'secondary'}>
                        {location.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{location.address}</p>
                    <p className="text-xs text-muted-foreground">
                      Created: {new Date(location.created_at).toLocaleDateString()}
                      {location.updated_at !== location.created_at && (
                        <> • Updated: {new Date(location.updated_at).toLocaleDateString()}</>
                      )}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEdit(location)}
                      disabled={isAdding || (editingId !== null && editingId !== location.id)}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDelete(location.id)}
                      disabled={loading || isAdding || editingId !== null}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <div className="text-sm text-muted-foreground border-t pt-4">
        <p>
          <strong>Note:</strong> This is a demo interface. In production, these operations would be
          connected to proper API endpoints.
        </p>
        <p>• Active locations are visible to customers in the schedule</p>
        <p>• Inactive locations are hidden but preserved for historical data</p>
        <p>• Deleting a location will also remove all associated offerings</p>
      </div>
    </div>
  );
}
