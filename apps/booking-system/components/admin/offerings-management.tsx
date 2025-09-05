"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Offering, Location } from "@/lib/database.types";
import { Plus, Edit2, Trash2, Save, X, Calendar, Clock, MapPin, Users, DollarSign } from "lucide-react";

interface OfferingsManagementProps {
  initialOfferings: Offering[];
  locations: Location[];
}

interface OfferingForm {
  date: string;
  time: string;
  session_type: string;
  location_id: string;
  cost: number;
  total_slots: number;
}

const SESSION_TYPES = [
  'Social',
  'Silent', 
  'Guided'
];

export function OfferingsManagement({ initialOfferings, locations }: OfferingsManagementProps) {
  const [offerings, setOfferings] = useState<Offering[]>(initialOfferings);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState<OfferingForm>({
    date: '',
    time: '',
    session_type: SESSION_TYPES[0],
    location_id: '',
    cost: 0,
    total_slots: 1
  });
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState({
    location: '',
    sessionType: '',
    dateFrom: ''
  });

  const activeLocations = locations.filter(loc => loc.active);

  const resetForm = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    setFormData({
      date: tomorrow.toISOString().split('T')[0],
      time: '09:00',
      session_type: SESSION_TYPES[0],
      location_id: activeLocations[0]?.id || '',
      cost: 35.00,
      total_slots: 8
    });
    setEditingId(null);
    setIsAdding(false);
  };

  const handleAdd = () => {
    setIsAdding(true);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    setFormData({
      date: tomorrow.toISOString().split('T')[0],
      time: '09:00',
      session_type: SESSION_TYPES[0],
      location_id: activeLocations[0]?.id || '',
      cost: 35.00,
      total_slots: 8
    });
  };

  const handleEdit = (offering: Offering) => {
    setEditingId(offering.id);
    setFormData({
      date: offering.date,
      time: offering.time,
      session_type: offering.session_type,
      location_id: offering.location_id,
      cost: offering.cost,
      total_slots: offering.total_slots
    });
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      if (isAdding) {
        console.log('Creating offering:', formData);
        const newOffering: Offering = {
          id: `temp-${Date.now()}`,
          ...formData,
          available_slots: formData.total_slots,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          location: locations.find(loc => loc.id === formData.location_id)
        };
        setOfferings([...offerings, newOffering]);
      } else if (editingId) {
        console.log('Updating offering:', editingId, formData);
        setOfferings(offerings.map(off => 
          off.id === editingId 
            ? { 
                ...off, 
                ...formData,
                available_slots: Math.min(off.available_slots, formData.total_slots),
                updated_at: new Date().toISOString(),
                location: locations.find(loc => loc.id === formData.location_id)
              }
            : off
        ));
      }
      resetForm();
    } catch (error) {
      console.error('Error saving offering:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    const offering = offerings.find(o => o.id === id);
    const bookedSlots = offering ? offering.total_slots - offering.available_slots : 0;
    
    if (bookedSlots > 0) {
      if (!confirm(`This offering has ${bookedSlots} booking(s). Deleting it will cancel these bookings. Are you sure?`)) {
        return;
      }
    } else if (!confirm('Are you sure you want to delete this offering?')) {
      return;
    }

    setLoading(true);
    try {
      console.log('Deleting offering:', id);
      setOfferings(offerings.filter(off => off.id !== id));
    } catch (error) {
      console.error('Error deleting offering:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredOfferings = offerings.filter(offering => {
    if (filter.location && offering.location_id !== filter.location) return false;
    if (filter.sessionType && offering.session_type !== filter.sessionType) return false;
    if (filter.dateFrom && offering.date < filter.dateFrom) return false;
    return true;
  });

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatTime = (timeString: string) => {
    const [hours, minutes] = timeString.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  const getSessionTypeColor = (sessionType: string) => {
    switch (sessionType.toLowerCase()) {
      case 'social':
        return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'silent':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'guided':
        return 'bg-purple-100 text-purple-800 border-purple-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const isFormValid = formData.date && formData.time && formData.location_id && 
                     formData.cost > 0 && formData.total_slots > 0;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-semibold">Offerings</h2>
        <Button onClick={handleAdd} disabled={isAdding || editingId !== null || activeLocations.length === 0}>
          <Plus className="h-4 w-4 mr-2" />
          Add Offering
        </Button>
      </div>

      {activeLocations.length === 0 && (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardContent className="p-4">
            <p className="text-yellow-800">
              No active locations available. Please add and activate at least one location before creating offerings.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="location-filter">Location</Label>
            <select
              id="location-filter"
              className="w-full p-2 border rounded-md"
              value={filter.location}
              onChange={(e) => setFilter({ ...filter, location: e.target.value })}
            >
              <option value="">All Locations</option>
              {locations.map(location => (
                <option key={location.id} value={location.id}>
                  {location.name} {!location.active && '(Inactive)'}
                </option>
              ))}
            </select>
          </div>
          
          <div>
            <Label htmlFor="session-type-filter">Session Type</Label>
            <select
              id="session-type-filter"
              className="w-full p-2 border rounded-md"
              value={filter.sessionType}
              onChange={(e) => setFilter({ ...filter, sessionType: e.target.value })}
            >
              <option value="">All Types</option>
              {SESSION_TYPES.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
          
          <div>
            <Label htmlFor="date-from-filter">Date From</Label>
            <Input
              id="date-from-filter"
              type="date"
              value={filter.dateFrom}
              onChange={(e) => setFilter({ ...filter, dateFrom: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      {(isAdding || editingId) && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle>
              {isAdding ? 'Add New Offering' : 'Edit Offering'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="date">Date *</Label>
                <Input
                  id="date"
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="time">Time *</Label>
                <Input
                  id="time"
                  type="time"
                  value={formData.time}
                  onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="session-type">Session Type *</Label>
                <select
                  id="session-type"
                  className="w-full p-2 border rounded-md"
                  value={formData.session_type}
                  onChange={(e) => setFormData({ ...formData, session_type: e.target.value })}
                >
                  {SESSION_TYPES.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">Location *</Label>
                <select
                  id="location"
                  className="w-full p-2 border rounded-md"
                  value={formData.location_id}
                  onChange={(e) => setFormData({ ...formData, location_id: e.target.value })}
                >
                  <option value="">Select Location</option>
                  {activeLocations.map(location => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cost">Cost ($) *</Label>
                <Input
                  id="cost"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.cost}
                  onChange={(e) => setFormData({ ...formData, cost: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="total-slots">Total Slots *</Label>
                <Input
                  id="total-slots"
                  type="number"
                  min="1"
                  value={formData.total_slots}
                  onChange={(e) => setFormData({ ...formData, total_slots: parseInt(e.target.value) || 1 })}
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button 
                onClick={handleSave} 
                disabled={!isFormValid || loading}
                className="flex-1"
              >
                <Save className="h-4 w-4 mr-2" />
                {loading ? 'Saving...' : 'Save'}
              </Button>
              <Button 
                variant="outline" 
                onClick={resetForm}
                disabled={loading}
                className="flex-1"
              >
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="text-sm text-muted-foreground">
        Showing {filteredOfferings.length} of {offerings.length} offerings
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredOfferings.length === 0 ? (
          <div className="col-span-full">
            <Card>
              <CardContent className="text-center py-12">
                <p className="text-muted-foreground">
                  {offerings.length === 0 ? 'No offerings found.' : 'No offerings match your filters.'}
                </p>
              </CardContent>
            </Card>
          </div>
        ) : (
          filteredOfferings
            .sort((a, b) => {
              const dateCompare = a.date.localeCompare(b.date);
              return dateCompare || a.time.localeCompare(b.time);
            })
            .map((offering) => (
              <Card key={offering.id} className={editingId === offering.id ? 'ring-2 ring-primary' : ''}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{formatDate(offering.date)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">{formatTime(offering.time)}</span>
                      </div>
                    </div>
                    <Badge 
                      variant="outline" 
                      className={getSessionTypeColor(offering.session_type)}
                    >
                      {offering.session_type}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MapPin className="h-4 w-4" />
                      <span>{offering.location?.name}</span>
                      {!offering.location?.active && (
                        <Badge variant="secondary" className="text-xs">Inactive Location</Badge>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold">${offering.cost.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span>
                        {offering.available_slots}/{offering.total_slots}
                        {offering.available_slots === 0 && (
                          <Badge variant="destructive" className="ml-2 text-xs">Full</Badge>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEdit(offering)}
                      disabled={isAdding || (editingId !== null && editingId !== offering.id)}
                      className="flex-1"
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDelete(offering.id)}
                      disabled={loading || isAdding || editingId !== null}
                      className="flex-1 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
        )}
      </div>

      <div className="text-sm text-muted-foreground border-t pt-4">
        <p><strong>Note:</strong> This is a demo interface. In production, these operations would be connected to proper API endpoints.</p>
        <p>• Available slots automatically adjust when bookings are made</p>
        <p>• Deleting offerings with bookings will cancel those bookings</p>
        <p>• Inactive locations are shown for admin reference but hidden from customers</p>
      </div>
    </div>
  );
}