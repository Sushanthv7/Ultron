import React, { useEffect, useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map,
  Pin,
  useAdvancedMarkerRef,
} from '@vis.gl/react-google-maps';
import {
  BookmarkPlus,
  Crosshair,
  ExternalLink,
  Loader2,
  MapPin,
  Search,
  Trash2,
} from 'lucide-react';
import { MarkdownText } from './MarkdownText';

export interface SavedLocationRecord {
  id: number;
  name: string;
  address: string;
  lat: number;
  lng: number;
  mapsUri: string;
  notes: string;
  createdAt?: string;
}

interface GroundedPlace {
  title: string;
  uri: string;
  placeId: string;
  reviewSnippets: string[];
}

interface TacticalMapViewProps {
  callsign: string;
  homeCity: string;
  isSignedIn: boolean;
  savedLocations: SavedLocationRecord[];
  onSaveLocation: (input: {
    name: string;
    address: string;
    lat: number;
    lng: number;
    mapsUri: string;
    notes: string;
  }) => Promise<void>;
  onDeleteLocation: (id: number) => Promise<void>;
  onRequestSignIn: () => void;
}

function safeExternalUrl(raw?: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    // Reject non-URL or disallowed schemes
  }
  return null;
}

function SavedPinMarker({
  location,
  selected,
  onSelect,
  onClose,
  onDelete,
}: {
  location: SavedLocationRecord;
  selected: boolean;
  onSelect: () => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [markerRef, marker] = useAdvancedMarkerRef();

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat: location.lat, lng: location.lng }}
        title={location.name}
        onClick={onSelect}
      >
        <Pin
          background="#ef4444"
          borderColor="#991b1b"
          glyphColor="#ffffff"
          scale={1.1}
        />
      </AdvancedMarker>
      {selected && marker && (
        <InfoWindow anchor={marker} maxWidth={260} onCloseClick={onClose}>
          <div className="p-1 text-slate-900">
            <div className="text-sm font-semibold">{location.name}</div>
            {location.address && (
              <div className="mt-0.5 text-xs text-slate-600">
                {location.address}
              </div>
            )}
            {location.notes && (
              <div className="mt-1 text-xs text-slate-700">{location.notes}</div>
            )}
            <div className="mt-2 flex items-center justify-between gap-3 border-t border-slate-200 pt-1.5 text-xs">
              <span className="font-mono text-[11px] text-slate-500">
                {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
              </span>
              <button
                type="button"
                onClick={onDelete}
                className="font-medium text-red-600 hover:underline"
              >
                Remove
              </button>
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
}

export function TacticalMapView({
  callsign,
  homeCity,
  isSignedIn,
  savedLocations,
  onSaveLocation,
  onDeleteLocation,
  onRequestSignIn,
}: TacticalMapViewProps) {
  const [mapsApiKey, setMapsApiKey] = useState<string>(
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
  );
  const [keyLoading, setKeyLoading] = useState<boolean>(
    !import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
  );

  const [center, setCenter] = useState<{ lat: number; lng: number }>({
    lat: 37.7749,
    lng: -122.4194,
  });
  const [zoom, setZoom] = useState<number>(12);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [locating, setLocating] = useState(false);

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [groundingText, setGroundingText] = useState<string>('');
  const [groundedPlaces, setGroundedPlaces] = useState<GroundedPlace[]>([]);

  const [draftPin, setDraftPin] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [pinName, setPinName] = useState('');
  const [pinNotes, setPinNotes] = useState('');
  const [savingPin, setSavingPin] = useState(false);
  const [selectedPinId, setSelectedPinId] = useState<number | null>(null);

  useEffect(() => {
    if (mapsApiKey) {
      setKeyLoading(false);
      return;
    }
    let cancelled = false;
    fetch('/api/maps/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { apiKey?: string } | null) => {
        if (!cancelled && data?.apiKey) {
          setMapsApiKey(data.apiKey);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setKeyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mapsApiKey]);

  const handleDeleteWaypoint = async (id: number) => {
    setSearchError(null);
    try {
      await onDeleteLocation(id);
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : 'Failed to delete saved waypoint.',
      );
    }
  };

  const handleGeolocate = () => {
    if (!navigator.geolocation) {
      setSearchError('Geolocation is not supported in this browser.');
      return;
    }
    setLocating(true);
    setSearchError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setUserCoords(coords);
        setCenter(coords);
        setDraftPin(coords);
        setZoom(14);
        setLocating(false);
      },
      () => {
        setSearchError(
          'Location access denied. Click anywhere on the map to set target coordinates.',
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const runMapsGrounding = async (overrideQuery?: string) => {
    const prompt = (overrideQuery ?? query).trim();
    if (!prompt || searching) return;

    if (overrideQuery) setQuery(overrideQuery);
    setSearching(true);
    setSearchError(null);

    const refCoords = draftPin ?? userCoords ?? center;

    try {
      const response = await fetch('/api/ultron/maps-grounding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: prompt,
          lat: refCoords.lat,
          lng: refCoords.lng,
          callsign,
        }),
      });
      const data = (await response.json()) as {
        text?: string;
        places?: GroundedPlace[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || 'Maps grounding query failed.');
      }
      setGroundingText(data.text || '');
      setGroundedPlaces(Array.isArray(data.places) ? data.places : []);
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : 'Unable to query Google Maps data.',
      );
    } finally {
      setSearching(false);
    }
  };

  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftPin || !pinName.trim() || savingPin) return;
    setSavingPin(true);
    setSearchError(null);
    try {
      await onSaveLocation({
        name: pinName.trim(),
        address: homeCity ? `${homeCity} Sector` : '',
        lat: draftPin.lat,
        lng: draftPin.lng,
        mapsUri: `https://www.google.com/maps/search/?api=1&query=${draftPin.lat},${draftPin.lng}`,
        notes: pinNotes.trim(),
      });
      setPinName('');
      setPinNotes('');
      setDraftPin(null);
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : 'Failed to persist pinned waypoint.',
      );
    } finally {
      setSavingPin(false);
    }
  };

  const quickQueries = [
    homeCity
      ? `Top independent coffee shops and quiet engineering workspaces in ${homeCity}`
      : 'Top quiet coffee shops and engineering workspaces nearby',
    'High-rated 24-hour pharmacies and urgent care centers nearby',
    'Scenic waterfront parks and running trails within 5 km',
  ];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Tactical Spatial Map &amp; Grounding
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-slate-400">
            Real-time Google Maps telemetry grounded with Gemini geospatial intelligence. Click anywhere on the map to target coordinates or save personal waypoints.
          </p>
        </div>

        <button
          type="button"
          onClick={handleGeolocate}
          disabled={locating}
          className="inline-flex min-h-[42px] shrink-0 items-center gap-2 self-start whitespace-nowrap rounded-lg border border-white/15 bg-[#0D1017] px-4 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-white/30 hover:text-white disabled:opacity-50 sm:self-auto"
        >
          {locating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
          ) : (
            <Crosshair className="ultron-accent-text h-3.5 w-3.5" />
          )}
          <span>Use My Location</span>
        </button>
      </div>

      {/* Main Split Grid */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Interactive Google Map Canvas */}
        <div className="lg:col-span-7">
          <div className="relative h-[460px] w-full overflow-hidden rounded-xl border border-white/15 bg-[#0D1017] sm:h-[540px]">
            {keyLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                <Loader2 className="ultron-accent-text mr-2 h-4 w-4 animate-spin" />
                Initializing spatial telemetry...
              </div>
            ) : !mapsApiKey ? (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                <MapPin className="h-8 w-8 text-amber-400" />
                <div className="mt-3 font-display text-base font-semibold text-white">
                  Google Maps API key unavailable
                </div>
                <p className="mt-1 max-w-md text-xs text-slate-400">
                  Restart the server after provisioning the Google Maps key, or use the Gemini Maps Grounding reconnaissance panel alongside.
                </p>
              </div>
            ) : (
              <APIProvider apiKey={mapsApiKey} libraries={['marker']}>
                <Map
                  mapId="DEMO_MAP_ID"
                  center={center}
                  zoom={zoom}
                  onCenterChanged={(ev) => setCenter(ev.detail.center)}
                  onZoomChanged={(ev) => setZoom(ev.detail.zoom)}
                  gestureHandling="greedy"
                  colorScheme="DARK"
                  internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                  onClick={(ev) => {
                    if (ev.detail.latLng) {
                      setDraftPin({
                        lat: ev.detail.latLng.lat,
                        lng: ev.detail.latLng.lng,
                      });
                    }
                  }}
                >
                  {userCoords && (
                    <AdvancedMarker
                      position={userCoords}
                      title="Current Architect Position"
                    >
                      <Pin
                        background="#f59e0b"
                        borderColor="#b45309"
                        glyphColor="#06070A"
                        scale={1.05}
                      />
                    </AdvancedMarker>
                  )}

                  {draftPin && (
                    <AdvancedMarker
                      position={draftPin}
                      title="Targeted Coordinate"
                    >
                      <Pin
                        background="#ffffff"
                        borderColor="#ef4444"
                        glyphColor="#ef4444"
                        scale={1.15}
                      />
                    </AdvancedMarker>
                  )}

                  {savedLocations.map((loc) => (
                    <SavedPinMarker
                      key={loc.id}
                      location={loc}
                      selected={selectedPinId === loc.id}
                      onSelect={() => setSelectedPinId(loc.id)}
                      onClose={() => setSelectedPinId(null)}
                      onDelete={() => {
                        setSelectedPinId(null);
                        void handleDeleteWaypoint(loc.id);
                      }}
                    />
                  ))}
                </Map>
              </APIProvider>
            )}
          </div>

          {/* Save Draft Waypoint Bar */}
          {draftPin && (
            <form
              onSubmit={handleSavePin}
              className="ultron-accent-border mt-4 rounded-xl border bg-[#0D1017] p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-medium text-white">
                  Targeted Coordinate:{' '}
                  <span className="font-mono text-amber-300">
                    {draftPin.lat.toFixed(5)}, {draftPin.lng.toFixed(5)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setDraftPin(null)}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Clear target
                </button>
              </div>

              {isSignedIn ? (
                <div className="mt-3 grid gap-2.5 sm:grid-cols-12">
                  <input
                    type="text"
                    value={pinName}
                    onChange={(e) => setPinName(e.target.value)}
                    placeholder="Waypoint name (e.g. Base Camp, Client HQ)"
                    required
                    className="ultron-accent-input min-h-[40px] rounded-lg border border-white/10 bg-[#06070A] px-3 text-xs text-white placeholder-slate-500 focus:outline-none sm:col-span-5"
                  />
                  <input
                    type="text"
                    value={pinNotes}
                    onChange={(e) => setPinNotes(e.target.value)}
                    placeholder="Optional tactical note"
                    className="ultron-accent-input min-h-[40px] rounded-lg border border-white/10 bg-[#06070A] px-3 text-xs text-white placeholder-slate-500 focus:outline-none sm:col-span-4"
                  />
                  <button
                    type="submit"
                    disabled={savingPin || !pinName.trim()}
                    className="ultron-accent-bg inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium text-white transition-colors disabled:opacity-45 sm:col-span-3"
                  >
                    <BookmarkPlus className="h-3.5 w-3.5" />
                    <span>{savingPin ? 'Saving...' : 'Save Pin'}</span>
                  </button>
                </div>
              ) : (
                <div className="mt-2.5 flex items-center justify-between gap-3 text-xs text-slate-400">
                  <span>Sign in with Google to persist personal waypoints to your encrypted vault.</span>
                  <button
                    type="button"
                    onClick={onRequestSignIn}
                    className="ultron-accent-text shrink-0 font-medium hover:opacity-85"
                  >
                    Sign in
                  </button>
                </div>
              )}
            </form>
          )}
        </div>

        {/* Right Column: Maps Grounding + Personal Saved Locations */}
        <div className="flex flex-col gap-5 lg:col-span-5">
          {/* Maps Grounding Reconnaissance */}
          <section className="rounded-xl border border-white/10 bg-[#0D1017] p-4 sm:p-5">
            <h2 className="font-display text-base font-semibold text-white">
              Ask ULTRON via Google Maps Data
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Grounded against live Google Maps places around the active map target.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                runMapsGrounding();
              }}
              className="mt-3 flex gap-2"
            >
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find quiet cafes, EV chargers, transit hubs..."
                className="ultron-accent-input min-h-[42px] flex-1 rounded-lg border border-white/10 bg-[#06070A] px-3 text-xs text-white placeholder-slate-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={searching || !query.trim()}
                className="ultron-accent-bg inline-flex min-h-[42px] shrink-0 items-center gap-1.5 rounded-lg px-4 text-xs font-medium text-white transition-colors disabled:opacity-45"
              >
                {searching ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
                <span>Scan</span>
              </button>
            </form>

            <div className="mt-3 flex flex-wrap gap-2">
              {quickQueries.map((q, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => runMapsGrounding(q)}
                  className="rounded-md border border-white/10 bg-[#06070A] px-2.5 py-1 text-left text-[11px] text-slate-300 transition-colors hover:border-white/25 hover:text-white"
                >
                  {q}
                </button>
              ))}
            </div>

            {searchError && (
              <div className="mt-3 rounded-lg border border-red-500/35 bg-red-950/25 px-3 py-2 text-xs text-red-200">
                {searchError}
              </div>
            )}

            {(groundingText || groundedPlaces.length > 0) && (
              <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
                {groundingText && (
                  <div className="max-h-[210px] overflow-y-auto pr-1 text-xs">
                    <MarkdownText content={groundingText} />
                  </div>
                )}

                {groundedPlaces.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                      Grounded Google Maps Sources
                    </div>
                    <div className="max-h-[200px] space-y-2 overflow-y-auto pr-1">
                      {groundedPlaces.map((place, idx) => {
                        const safeHref = safeExternalUrl(place.uri);
                        return (
                          <div
                            key={`${place.placeId || place.uri}-${idx}`}
                            className="rounded-lg border border-white/10 bg-[#06070A] p-2.5"
                          >
                            {safeHref ? (
                              <a
                                href={safeHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-300 hover:text-amber-200 hover:underline"
                              >
                                <span>{place.title}</span>
                                <ExternalLink className="h-3 w-3 shrink-0" />
                              </a>
                            ) : (
                              <span className="text-xs font-semibold text-slate-200">
                                {place.title}
                              </span>
                            )}
                            {place.reviewSnippets.length > 0 && (
                              <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-400">
                                “{place.reviewSnippets[0]}”
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Saved Personal Waypoints */}
          <section className="rounded-xl border border-white/10 bg-[#0D1017] p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-white">
                Personal Waypoints
              </h2>
              <span className="font-mono text-xs tabular-nums text-slate-400">
                {savedLocations.length} saved
              </span>
            </div>

            {!isSignedIn ? (
              <div className="mt-3 rounded-lg border border-white/[0.07] bg-[#06070A] p-4 text-xs text-slate-400">
                Sign in with Google in the header to store and sync personal map waypoints across sessions.
              </div>
            ) : savedLocations.length === 0 ? (
              <div className="mt-3 rounded-lg border border-white/[0.07] bg-[#06070A] p-4 text-xs text-slate-400">
                Click anywhere on the map or use your live location to pin and save personal waypoints.
              </div>
            ) : (
              <div className="mt-3 max-h-[230px] space-y-2 overflow-y-auto pr-1">
                {savedLocations.map((loc) => (
                  <div
                    key={loc.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-[#06070A] p-3"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setCenter({ lat: loc.lat, lng: loc.lng });
                        setZoom(15);
                        setSelectedPinId(loc.id);
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="truncate text-xs font-semibold text-white hover:text-red-400">
                        {loc.name}
                      </div>
                      {loc.notes && (
                        <div className="mt-0.5 truncate text-[11px] text-slate-400">
                          {loc.notes}
                        </div>
                      )}
                      <div className="mt-1 font-mono text-[11px] text-slate-500">
                        {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
                      </div>
                    </button>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {safeExternalUrl(loc.mapsUri) && (
                        <a
                          href={safeExternalUrl(loc.mapsUri)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open ${loc.name} in Google Maps`}
                          className="rounded p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-amber-300"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleDeleteWaypoint(loc.id)}
                        aria-label={`Delete ${loc.name}`}
                        className="rounded p-1.5 text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
