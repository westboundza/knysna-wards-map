(function () {
    'use strict';

    if (typeof kwmData === 'undefined') return;

    var map, wardLayers = {}, poiLayers = {}, wardLabels = {}, wardVisible = {};
    var activePopupWard = null;
    var defaultCenter = [-34.0350, 23.0450];
    var defaultZoom = parseInt(kwmData.zoom) || 13;

    var poiIcons = {
        school:     { icon: '\uD83C\uDFEB' },
        health:     { icon: '\uD83C\uDFE5' },
        church:     { icon: '\u26EA' },
        sport:      { icon: '\u26BD' },
        place:      { icon: '\uD83D\uDCCD' },
        government: { icon: '\uD83C\uDFDB' },
    };

    function createPoiIcon(type) {
        var cfg = poiIcons[type] || poiIcons.place;
        return L.divIcon({
            html: '<div style="font-size:20px;text-align:center;line-height:1;">' + cfg.icon + '</div>',
            className: 'kwm-marker-icon',
            iconSize: [26, 26],
            iconAnchor: [13, 13],
            popupAnchor: [0, -13],
        });
    }

    function buildPopup(poi) {
        return '<div class="kwm-popup">' +
            '<h4>' + poi.name + '</h4>' +
            '<span class="kwm-poi-type kwm-poi-type-' + poi.type + '">' + poi.type + '</span>' +
            '</div>';
    }

    function buildWardTooltip(ward) {
        var html = '<div class="kwm-popup">';
        html += '<h4>' + ward.name + '</h4>';
        if (ward.councillor && ward.councillor.indexOf('Councillor') === -1) {
            html += '<p><strong>' + ward.councillor + '</strong> (' + ward.party + ')</p>';
        }
        if (ward.political_culture) {
            html += '<span style="display:inline-block;padding:2px 6px;border-radius:8px;font-size:10px;font-weight:700;color:#fff;background:' + (ward.culture_color || '#999') + ';">' + ward.political_culture + '</span>';
        }
        html += '<p style="font-size:11px;color:#888;margin-top:4px;">Click for details</p>';
        html += '</div>';
        return html;
    }

    function buildWardDetailPopup(ward) {
        var html = '<div class="kwm-detail-popup">';

        // Top card: photo | party logo | ward info (3 columns like the PDF)
        html += '<div class="kwm-card-row">';
        if (ward.image) {
            html += '<div class="kwm-card-photo"><img src="' + ward.image + '" alt="' + ward.councillor + '"></div>';
        }
        html += '<div class="kwm-card-info">';
        html += '<h3>' + ward.name + '</h3>';
        if (ward.areas && ward.areas.length) {
            html += '<p class="kwm-card-location">' + ward.areas.join(', ') + '</p>';
        }
        if (ward.councillor) html += '<p class="kwm-card-name">' + ward.councillor + '</p>';
        if (ward.party) {
            html += '<div class="kwm-card-party-row">';
            if (ward.party_logo && kwmData.logosUrl) {
                html += '<img class="kwm-card-party-logo" src="' + kwmData.logosUrl + ward.party_logo + '" alt="' + ward.party + '">';
            }
            html += '<span>' + ward.party + '</span>';
            html += '</div>';
        }
        if (ward.phone) html += '<p>Tel ' + ward.phone + '</p>';
        if (ward.email) html += '<p><a href="mailto:' + ward.email + '">' + ward.email + '</a></p>';
        if (ward.revenue_rm) html += '<p class="kwm-card-fiscal" title="' + (ward.key_revenue || '') + '">Revenue: R' + ward.revenue_rm + 'M (' + (ward.revenue_pct || 0) + '%) &middot; ' + (ward.indigent_pct || 0) + '% indigent</p>';
        html += '</div>';
        // PR votes in top row
        if (ward.pr_votes) {
            var partyColors = { DA: '#005BA6', ANC: '#009933', EFF: '#e4003b', PA: '#DAA520', KIM: '#8B4513', PBI: '#ff6600', 'FF+': '#F48221', Good: '#00B050', Other: '#999' };
            var parties = Object.keys(ward.pr_votes).sort(function (a, b) { return ward.pr_votes[b] - ward.pr_votes[a]; });
            html += '<div class="kwm-card-pr">';
            html += '<div class="kwm-pr-header">PR (2021) ' + (ward.pr_turnout || '') + '</div>';
            html += '<div class="kwm-pr-bar">';
            parties.forEach(function (p) {
                var pct = ((ward.pr_votes[p] / ward.pr_total) * 100).toFixed(1);
                var color = partyColors[p] || '#999';
                if (parseFloat(pct) > 2) {
                    html += '<div class="kwm-pr-segment" style="width:' + pct + '%;background:' + color + ';">' + (parseFloat(pct) > 8 ? p : '') + '</div>';
                }
            });
            html += '</div>';
            html += '<div class="kwm-pr-list">';
            parties.forEach(function (p) {
                var pct = ((ward.pr_votes[p] / ward.pr_total) * 100).toFixed(1);
                var color = partyColors[p] || '#999';
                html += '<span class="kwm-pr-item"><span class="kwm-pr-dot" style="background:' + color + ';"></span>' + p + ' ' + pct + '%</span>';
            });
            html += '</div>';
            html += '</div>';
        }
        html += '</div>';

        // Bottom row: culture+areas | priorities+notes | PR bar
        html += '<div class="kwm-card-bottom">';

        // Column 1: culture + priorities
        html += '<div class="kwm-card-col">';
        if (ward.political_culture) {
            html += '<div class="kwm-culture-badge" style="background:' + (ward.culture_color || '#999') + ';">' + ward.political_culture + '</div>';
        }
        if (ward.constituent_priorities) html += '<p class="kwm-priorities">' + ward.constituent_priorities + '</p>';
        html += '</div>';

        // Column 2: notes
        html += '<div class="kwm-card-col">';
        html += '</div>';

        html += '</div>';

        html += '</div>';
        return html;
    }

    function getPolygonCenter(coords) {
        var latSum = 0, lngSum = 0;
        coords.forEach(function (c) { latSum += c[0]; lngSum += c[1]; });
        return [latSum / coords.length, lngSum / coords.length];
    }

    // Find the best interior point using a grid search
    function getVisualCenter(polygon) {
        var bounds = polygon.getBounds();
        var center = bounds.getCenter();
        var polyPoints = polygon.getLatLngs()[0];

        function pip(lat, lng) {
            var inside = false;
            for (var i = 0, j = polyPoints.length - 1; i < polyPoints.length; j = i++) {
                var yi = polyPoints[i].lng, xi = polyPoints[i].lat;
                var yj = polyPoints[j].lng, xj = polyPoints[j].lat;
                if (((yi > lng) !== (yj > lng)) && (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi)) {
                    inside = !inside;
                }
            }
            return inside;
        }

        // Distance from point to nearest polygon edge
        function distToNearestEdge(lat, lng) {
            var minDist = Infinity;
            for (var i = 0, j = polyPoints.length - 1; i < polyPoints.length; j = i++) {
                var ax = polyPoints[j].lat, ay = polyPoints[j].lng;
                var bx = polyPoints[i].lat, by = polyPoints[i].lng;
                var dx = bx - ax, dy = by - ay;
                var t = Math.max(0, Math.min(1, ((lat - ax) * dx + (lng - ay) * dy) / (dx * dx + dy * dy)));
                var px = ax + t * dx, py = ay + t * dy;
                var d = Math.sqrt((lat - px) * (lat - px) + (lng - py) * (lng - py));
                if (d < minDist) minDist = d;
            }
            return minDist;
        }

        if (pip(center.lat, center.lng)) {
            // Check if center is reasonably far from edges
            var cd = distToNearestEdge(center.lat, center.lng);
            var span = Math.max(bounds.getNorth() - bounds.getSouth(), bounds.getEast() - bounds.getWest());
            if (cd > span * 0.1) return center;
        }

        var best = center;
        var bestDist = -1;
        var steps = 20;
        var latStep = (bounds.getNorth() - bounds.getSouth()) / steps;
        var lngStep = (bounds.getEast() - bounds.getWest()) / steps;

        for (var i = 1; i < steps; i++) {
            for (var j = 1; j < steps; j++) {
                var lat = bounds.getSouth() + latStep * i;
                var lng = bounds.getWest() + lngStep * j;
                if (pip(lat, lng)) {
                    var d = distToNearestEdge(lat, lng);
                    if (d > bestDist) {
                        bestDist = d;
                        best = L.latLng(lat, lng);
                    }
                }
            }
        }
        return best;
    }

    function addWard(key, ward) {
        var polygon = L.polygon(ward.boundary, {
            color: ward.color,
            fillColor: ward.color,
            fillOpacity: 0.3,
            weight: 2,
            wardKey: key,
        });

        // Hover effect
        polygon.on('mouseover', function (e) {
            this.setStyle({ fillOpacity: 0.5, weight: 3 });
        });
        polygon.on('mouseout', function (e) {
            this.setStyle({ fillOpacity: 0.3, weight: 2 });
        });

        // Click to toggle detail popup
        polygon.on('click', function (e) {
            if (activePopupWard === key) {
                map.closePopup();
                activePopupWard = null;
                return;
            }
            map.fitBounds(polygon.getBounds(), { padding: [50, 50] });
            setTimeout(function () {
                var center = getVisualCenter(polygon);
                var popup = L.popup({ maxWidth: 440, className: 'kwm-ward-popup', autoPanPaddingTopLeft: [10, 80], autoPanPaddingBottomRight: [10, 10] })
                    .setLatLng(center)
                    .setContent(buildWardDetailPopup(ward))
                    .openOn(map);
            }, 400);
            activePopupWard = key;
            document.getElementById('kwm-ward-select').value = key;
        });

        // Ward label at visual center
        var center = getVisualCenter(polygon);
        var logoHtml = '';
        if (ward.party_logo && kwmData.logosUrl) {
            logoHtml = '<img src="' + kwmData.logosUrl + ward.party_logo + '" class="kwm-label-logo">';
        }
        // Enhanced label with optional fiscal, capex, vote data
        var revRm = ward.revenue_rm || 0;
        var revPct = ward.revenue_pct || 0;
        var capexRm = ward.capex_rm || 0;
        var capexPct = ward.capex_pct || 0;
        var prTotal = ward.pr_total || 0;
        var allPrTotal = 0;
        Object.keys(kwmData.wards).forEach(function (k) { allPrTotal += kwmData.wards[k].pr_total || 0; });
        var votePct = allPrTotal > 0 ? (prTotal / allPrTotal * 100).toFixed(1) : '0';
        // Top-3 parties row
        var topPartiesHtml = '';
        if (ward.pr_votes) {
            var prVotes = ward.pr_votes;
            var prTotalW = ward.pr_total || 1;
            var sortedParties = Object.keys(prVotes).sort(function (a, b) { return prVotes[b] - prVotes[a]; }).slice(0, 3);
            topPartiesHtml = '<div class="kwm-label-parties">';
            sortedParties.forEach(function (p) {
                var pct = (prVotes[p] / prTotalW * 100).toFixed(0);
                var clr = partyColors[p] || '#999';
                topPartiesHtml += '<span class="kwm-label-party-pill" style="--party-clr:' + clr + ';">' + p + ' ' + pct + '%</span>';
            });
            topPartiesHtml += '</div>';
        }

        var enhancedHtml = '<div class="kwm-label-enhanced">' +
            '<div class="kwm-label-inner">' + logoHtml + '<span>' + ward.name + '</span></div>' +
            '<div class="kwm-label-stats">' +
            '<span class="kwm-label-rev kwm-stat-fiscal" title="Est. revenue contribution (2025/26)">Rev R' + revRm + 'M (' + revPct + '%)</span>' +
            '<span class="kwm-label-capex kwm-stat-capex" title="Capital expenditure (2025/26 Annexure C)">CapEx R' + capexRm + 'M (' + capexPct + '%)</span>' +
            '<span class="kwm-label-votes kwm-stat-votes" title="PR votes cast (2021)">' + prTotal.toLocaleString() + ' votes (' + votePct + '%)</span>' +
            '</div>' + topPartiesHtml + '</div>';

        var label = L.marker(center, {
            icon: L.divIcon({
                html: enhancedHtml,
                className: 'kwm-ward-label',
                iconSize: [120, 48],
                iconAnchor: [60, 24],
            }),
            interactive: false,
        });

        var poiGroup = L.layerGroup();
        if (ward.poi) {
            ward.poi.forEach(function (p) {
                var marker = L.marker([p.lat, p.lng], { icon: createPoiIcon(p.type) });
                marker.bindPopup(buildPopup(p));
                poiGroup.addLayer(marker);
            });
        }

        // Party logo marker (shown in party color mode)
        var partyLogoUrl = ward.party_logo && kwmData.logosUrl ? kwmData.logosUrl + ward.party_logo : '';
        if (partyLogoUrl) {
            var logoMarker = L.marker(center, {
                icon: L.divIcon({
                    html: '<div class="kwm-party-marker"><img src="' + partyLogoUrl + '" alt="' + (ward.party || '') + '"></div>',
                    className: 'kwm-party-marker-icon',
                    iconSize: [40, 40],
                    iconAnchor: [20, 20],
                }),
                interactive: false,
            });
            partyLogoMarkers[key] = logoMarker;
        }

        wardLayers[key] = polygon;
        poiLayers[key] = poiGroup;
        wardLabels[key] = label;
        wardVisible[key] = true;

        polygon.addTo(map);
        label.addTo(map);
        // POIs off by default
        var poiToggle = document.getElementById('kwm-toggle-poi');
        if (poiToggle && poiToggle.checked) {
            poiGroup.addTo(map);
        }
    }

    function toggleWard(key, show) {
        wardVisible[key] = show;
        if (show) {
            wardLayers[key].addTo(map);
            wardLabels[key].addTo(map);
            if (document.getElementById('kwm-toggle-poi') && document.getElementById('kwm-toggle-poi').checked) {
                poiLayers[key].addTo(map);
            }
        } else {
            map.removeLayer(wardLayers[key]);
            map.removeLayer(wardLabels[key]);
            map.removeLayer(poiLayers[key]);
        }
    }

    function showWardPopup(key) {
        var ward = kwmData.wards[key];
        if (!ward || !wardLayers[key]) return;
        setTimeout(function () {
            var center = getVisualCenter(wardLayers[key]);
            L.popup({ maxWidth: 440, className: 'kwm-ward-popup', autoPanPaddingTopLeft: [10, 80], autoPanPaddingBottomRight: [10, 10] })
                .setLatLng(center)
                .setContent(buildWardDetailPopup(ward))
                .openOn(map);
        }, 400);
        activePopupWard = key;
    }

    function populateSelect() {
        var select = document.getElementById('kwm-ward-select');
        if (!select) return;

        var keys = Object.keys(kwmData.wards).sort(function (a, b) { return parseInt(a) - parseInt(b); });
        keys.forEach(function (key) {
            var opt = document.createElement('option');
            opt.value = key;
            opt.textContent = kwmData.wards[key].name + ' — ' + kwmData.wards[key].areas.join(', ');
            select.appendChild(opt);
        });

        select.addEventListener('change', function () {
            var val = this.value;
            if (val === 'all') {
                resetView();
                document.getElementById('kwm-ward-info').innerHTML = '';
                return;
            }
            focusWard(val);
        });
    }

    function focusWard(key) {
        if (wardLayers[key]) {
            map.fitBounds(wardLayers[key].getBounds(), { padding: [50, 50] });
            showWardPopup(key);
        }
    }

    function resetView() {
        var layers = Object.values(wardLayers);
        if (layers.length > 0) {
            var group = L.featureGroup(layers);
            map.fitBounds(group.getBounds(), { padding: [30, 30] });
        } else {
            map.setView(defaultCenter, defaultZoom);
        }
    }

    function addWardFilters() {
        var container = document.getElementById('kwm-ward-filters');
        if (!container) return;

        var html = '<span class="kwm-filter-label">Wards</span>';
        html += '<span class="kwm-ward-chip-btn" id="kwm-chip-all">All</span>';
        html += '<span class="kwm-ward-chip-btn" id="kwm-chip-none">None</span>';
        var keys = Object.keys(kwmData.wards).sort(function (a, b) { return parseInt(a) - parseInt(b); });
        keys.forEach(function (key) {
            var w = kwmData.wards[key];
            html += '<span class="kwm-ward-chip active" data-ward="' + key + '" style="--ward-clr:' + w.color + ';">' + key + '</span>';
        });
        container.innerHTML = html;

        container.querySelectorAll('.kwm-ward-chip').forEach(function (chip) {
            chip.addEventListener('click', function () {
                var k = this.getAttribute('data-ward');
                var isActive = this.classList.toggle('active');
                toggleWard(k, isActive);
            });
        });

        container.querySelector('#kwm-chip-all').addEventListener('click', function () {
            container.querySelectorAll('.kwm-ward-chip').forEach(function (chip) {
                chip.classList.add('active');
                toggleWard(chip.getAttribute('data-ward'), true);
            });
        });

        container.querySelector('#kwm-chip-none').addEventListener('click', function () {
            container.querySelectorAll('.kwm-ward-chip').forEach(function (chip) {
                chip.classList.remove('active');
                toggleWard(chip.getAttribute('data-ward'), false);
            });
        });
    }

    var currentColorMode = 'ward';
    var partyLogoMarkers = {};

    var partyColors = { DA: '#005BA6', ANC: '#009933', EFF: '#e4003b', PA: '#DAA520', KIM: '#8B4513', PBI: '#ff6600', 'FF+': '#F48221', Good: '#00B050', Other: '#999' };

    function getColorForMode(ward, mode) {
        if (mode === 'culture') return ward.culture_color || '#999';
        if (mode === 'election') return ward.party_color || '#999';
        return ward.color;
    }

    function buildMiniChart(ward) {
        var votes = ward.pr_votes || {};
        var total = ward.pr_total || 1;
        var parties = Object.keys(votes).sort(function (a, b) { return votes[b] - votes[a]; });

        var html = '<div class="kwm-mini-chart">';
        html += '<div class="kwm-mini-total">' + ward.name + ': ' + total.toLocaleString() + ' PR votes &middot; ' + (ward.pr_turnout || '') + '</div>';
        html += '<div class="kwm-mini-bar">';
        parties.forEach(function (p) {
            var pct = (votes[p] / total * 100).toFixed(1);
            var color = partyColors[p] || '#999';
            if (parseFloat(pct) > 1.5) {
                html += '<div class="kwm-mini-seg" style="width:' + pct + '%;background:' + color + ';" title="' + p + ' ' + pct + '%">';
                if (parseFloat(pct) > 10) html += p;
                html += '</div>';
            }
        });
        html += '</div>';
        html += '<div class="kwm-mini-legend">';
        parties.forEach(function (p) {
            var pct = (votes[p] / total * 100).toFixed(1);
            if (parseFloat(pct) > 1.5) {
                html += '<span><b style="color:' + (partyColors[p] || '#999') + ';">' + p + '</b> ' + votes[p] + ' (' + pct + '%)</span>';
            }
        });
        html += '</div>';
        html += '</div>';
        return html;
    }

    var electionMarkers = {};

    function setColorMode(mode) {
        currentColorMode = mode;
        var mapEl = document.getElementById('kwm-map');
        var councilBar = document.getElementById('kwm-council-bar');
        if (mode === 'election') {
            mapEl.classList.add('kwm-grayscale');
        } else {
            mapEl.classList.remove('kwm-grayscale');
        }
        var keys = Object.keys(kwmData.wards);
        keys.forEach(function (key) {
            var ward = kwmData.wards[key];
            var color = getColorForMode(ward, mode);

            if (wardLayers[key]) {
                wardLayers[key].setStyle({ color: color, fillColor: color, fillOpacity: 0.3 });
            }

            // Election markers controlled by checkbox, not color mode
            // Just ensure markers exist (lazy create)
            if (!electionMarkers[key] && ward.pr_votes && wardLayers[key]) {
                var emCenter = getVisualCenter(wardLayers[key]);
                electionMarkers[key] = L.marker(emCenter, {
                    icon: L.divIcon({
                        html: buildMiniChart(ward),
                        className: 'kwm-mini-chart-icon',
                        iconSize: [160, 70],
                        iconAnchor: [80, 35],
                    }),
                    interactive: false,
                });
            }
        });
        // Update chip colors
        document.querySelectorAll('.kwm-ward-chip').forEach(function (chip) {
            var k = chip.getAttribute('data-ward');
            var ward = kwmData.wards[k];
            chip.style.setProperty('--ward-clr', getColorForMode(ward, mode));
        });
    }

    function setupToggles() {
        var poiToggle = document.getElementById('kwm-toggle-poi');
        if (poiToggle) {
            poiToggle.addEventListener('change', function () {
                var show = this.checked;
                Object.keys(poiLayers).forEach(function (k) {
                    if (show && wardVisible[k]) {
                        poiLayers[k].addTo(map);
                    } else {
                        map.removeLayer(poiLayers[k]);
                    }
                });
            });
        }

        var labelToggle = document.getElementById('kwm-toggle-labels');
        if (labelToggle) {
            labelToggle.addEventListener('change', function () {
                var show = this.checked;
                Object.keys(wardLabels).forEach(function (k) {
                    if (show && wardVisible[k]) {
                        wardLabels[k].addTo(map);
                    } else {
                        map.removeLayer(wardLabels[k]);
                    }
                });
            });
        }

        // Party icons toggle
        var partyToggle = document.getElementById('kwm-toggle-party');
        var container = document.querySelector('.kwm-container');
        if (partyToggle && container) {
            container.classList.add('kwm-show-party');
            partyToggle.addEventListener('change', function () {
                container.classList.toggle('kwm-show-party', this.checked);
            });
        }

        // Top-3 parties toggle
        var topPartiesToggle = document.getElementById('kwm-toggle-top-parties');
        if (topPartiesToggle && container) {
            topPartiesToggle.addEventListener('change', function () {
                container.classList.toggle('kwm-show-top-parties', this.checked);
            });
        }

        var colorMode = document.getElementById('kwm-color-mode');
        if (colorMode) {
            colorMode.addEventListener('change', function () {
                setColorMode(this.value);
            });
        }

        // Fiscal + Votes toggles (use body class for CSS specificity)
        var mapContainer = document.querySelector('.kwm-container');
        var fiscalToggle = document.getElementById('kwm-toggle-fiscal');
        if (fiscalToggle && mapContainer) {
            fiscalToggle.addEventListener('change', function () {
                mapContainer.classList.toggle('kwm-show-fiscal', this.checked);
            });
        }
        var capexToggle = document.getElementById('kwm-toggle-capex');
        if (capexToggle && mapContainer) {
            capexToggle.addEventListener('change', function () {
                mapContainer.classList.toggle('kwm-show-capex', this.checked);
            });
        }
        var votesToggle = document.getElementById('kwm-toggle-votes');
        if (votesToggle && mapContainer) {
            // Build total votes block
            var allWardKeys = Object.keys(kwmData.wards);
            var grandTotal = 0;
            var partyTotals = {};
            allWardKeys.forEach(function (k) {
                var w = kwmData.wards[k];
                grandTotal += w.pr_total || 0;
                var pv = w.pr_votes || {};
                Object.keys(pv).forEach(function (p) {
                    partyTotals[p] = (partyTotals[p] || 0) + pv[p];
                });
            });
            var sortedP = Object.keys(partyTotals).sort(function (a, b) { return partyTotals[b] - partyTotals[a]; });
            var pHtml = sortedP.map(function (p) {
                var pct = grandTotal > 0 ? (partyTotals[p] / grandTotal * 100).toFixed(1) : '0';
                var clr = partyColors[p] || '#999';
                return '<div class="kwm-vt-row"><span class="kwm-vt-dot" style="background:' + clr + ';"></span><span class="kwm-vt-party">' + p + '</span><span class="kwm-vt-pct">' + pct + '%</span><span class="kwm-vt-num">' + partyTotals[p].toLocaleString() + '</span></div>';
            }).join('');
            var vtBlock = document.createElement('div');
            vtBlock.id = 'kwm-votes-total';
            vtBlock.innerHTML = '<div class="kwm-vt-title">Total PR Votes <span class="kwm-vt-grand">' + grandTotal.toLocaleString() + '</span></div>' + pHtml;
            document.getElementById('kwm-map').appendChild(vtBlock);

            votesToggle.addEventListener('change', function () {
                mapContainer.classList.toggle('kwm-show-votes', this.checked);
                vtBlock.style.display = this.checked ? 'block' : 'none';
            });
            vtBlock.style.display = 'none';
        }

        // PR Charts toggle
        var electionToggle = document.getElementById('kwm-toggle-election');
        if (electionToggle) {
            electionToggle.addEventListener('change', function () {
                var keys = Object.keys(kwmData.wards);
                if (this.checked) {
                    keys.forEach(function (key) {
                        if (electionMarkers[key] && wardVisible[key]) {
                            electionMarkers[key].addTo(map);
                        }
                    });
                } else {
                    keys.forEach(function (key) {
                        if (electionMarkers[key]) map.removeLayer(electionMarkers[key]);
                    });
                }
            });
        }

        // Cadastral layer (Knysna Municipality Property Info - direct GeoJSON query)
        var cadastralToggle = document.getElementById('kwm-toggle-cadastral');
        if (cadastralToggle) {
            var cadGeoJson = null;
            var cadLabels = L.layerGroup();
            var cadActive = false;
            var cadLoading = false;

            function loadCadastral() {
                if (!cadActive || cadLoading || map.getZoom() < 15) return;
                cadLoading = true;
                var b = map.getBounds();
                var url = 'https://services3.arcgis.com/Kb9idbuOS9ILjfGd/arcgis/rest/services/Property_Info/FeatureServer/0/query' +
                    '?where=1%3D1&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326' +
                    '&geometry=' + encodeURIComponent(b.getWest() + ',' + b.getSouth() + ',' + b.getEast() + ',' + b.getNorth()) +
                    '&returnGeometry=true&outFields=ERFNO,PROP_DESC,TOWN,PropertyType&resultRecordCount=2000&f=geojson';

                fetch(url).then(function (r) { return r.json(); }).then(function (data) {
                    cadLoading = false;
                    if (!cadActive) return;
                    if (cadGeoJson) map.removeLayer(cadGeoJson);
                    cadLabels.clearLayers();

                    cadGeoJson = L.geoJSON(data, {
                        style: { color: '#FF00FF', weight: 2, fillOpacity: 0.05, opacity: 0.9 },
                        onEachFeature: function (feature, layer) {
                            var p = feature.properties;
                            var erf = p.ERFNO || '';
                            layer.bindPopup('<div class="kwm-popup"><h4>Erf ' + erf + '</h4>' +
                                '<p>' + (p.PROP_DESC || '') + '</p>' +
                                '<p>' + (p.TOWN || '') + ' &mdash; ' + (p.PropertyType || '') + '</p></div>');
                            if (erf) {
                                try {
                                    var c = layer.getBounds().getCenter();
                                    cadLabels.addLayer(L.marker(c, {
                                        icon: L.divIcon({
                                            html: '<span class="kwm-erf-label">' + erf + '</span>',
                                            className: 'kwm-erf-label-icon',
                                            iconSize: [60, 14],
                                            iconAnchor: [30, 7],
                                        }),
                                        interactive: false,
                                    }));
                                } catch (e) {}
                            }
                        },
                    }).addTo(map);
                    cadLabels.addTo(map);
                }).catch(function () { cadLoading = false; });
            }

            cadastralToggle.addEventListener('change', function () {
                cadActive = this.checked;
                if (this.checked) {
                    if (map.getZoom() < 15) map.setZoom(16);
                    loadCadastral();
                    map.on('moveend', loadCadastral);
                } else {
                    map.off('moveend', loadCadastral);
                    if (cadGeoJson) { map.removeLayer(cadGeoJson); cadGeoJson = null; }
                    cadLabels.clearLayers();
                    map.removeLayer(cadLabels);
                }
            });
        }

        // Ward data modal
        var wardDataBtn = document.getElementById('kwm-ward-data-btn');
        var wardDataOverlay = document.getElementById('kwm-ward-data-overlay');
        var dataTbody = document.getElementById('kwm-data-tbody');
        if (wardDataBtn && wardDataOverlay && dataTbody) {
            // Populate table
            var allPrT = 0;
            var wkeys = Object.keys(kwmData.wards).sort(function (a, b) { return parseInt(a) - parseInt(b); });
            wkeys.forEach(function (k) { allPrT += kwmData.wards[k].pr_total || 0; });
            var tOwn=0, tRates=0, tSvc=0, tMar=0, tGr=0, tRev=0, tCap=0, tVot=0;
            var rows = '';
            wkeys.forEach(function (k) {
                var w = kwmData.wards[k];
                var own=w.rev_own||0, rates=w.rev_rates||0, svc=w.rev_service_gross||0, mar=w.rev_service_margin||0, gr=w.rev_grants||0;
                var rev=w.revenue_rm||0, cap=w.capex_rm||0, vot=w.pr_total||0;
                var vPct = allPrT > 0 ? (vot / allPrT * 100).toFixed(1) : '0';
                tOwn+=own; tRates+=rates; tSvc+=svc; tMar+=mar; tGr+=gr; tRev+=rev; tCap+=cap; tVot+=vot;
                rows += '<tr><td><b>' + k + '</b></td><td>' + (w.areas || []).join(', ') + '</td>';
                rows += '<td>' + (w.councillor || '').replace('Cllr ', '') + '</td>';
                rows += '<td style="color:' + (partyColors[w.party] || '#999') + ';font-weight:700;">' + (w.party || '') + '</td>';
                rows += '<td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + (w.culture_color||'#999') + ';margin-right:3px;"></span>' + (w.political_culture || '') + '</td>';
                rows += '<td style="color:#2e7d32;font-weight:700;">R' + own + 'M</td>';
                rows += '<td style="color:#558b2f;">R' + rates + 'M</td>';
                rows += '<td style="color:#f57c00;">R' + svc + 'M</td>';
                rows += '<td style="color:#e65100;font-weight:700;">R' + mar + 'M</td>';
                var netCash = own + mar;
                rows += '<td style="font-weight:700;">R' + rev + 'M</td>';
                rows += '<td style="color:#2e7d32;font-weight:800;background:rgba(46,125,50,0.06);">R' + netCash + 'M</td>';
                rows += '<td>R' + cap + 'M</td>';
                rows += '<td>' + vot.toLocaleString() + '</td><td>' + vPct + '%</td></tr>';
            });
            var tNet = tOwn + tMar;
            // Subtotal (ward-level)
            rows += '<tr class="kwm-data-total"><td colspan="5"><b>Subtotal (ward-level)</b></td>';
            rows += '<td style="color:#2e7d32;"><b>R' + tOwn + 'M</b></td>';
            rows += '<td style="color:#558b2f;"><b>R' + tRates + 'M</b></td>';
            rows += '<td style="color:#f57c00;"><b>R' + tSvc + 'M</b></td>';
            rows += '<td style="color:#e65100;"><b>R' + tMar + 'M</b></td>';
            rows += '<td><b>R' + (tRev - tGr) + 'M</b></td>';
            rows += '<td style="color:#2e7d32;font-weight:800;background:rgba(46,125,50,0.06);"><b>R' + tNet + 'M</b></td>';
            rows += '<td><b>R' + tCap.toFixed(1) + 'M</b></td>';
            rows += '<td><b>' + tVot.toLocaleString() + '</b></td><td><b>100%</b></td></tr>';
            // Grants line item
            rows += '<tr style="background:rgba(21,101,192,0.06);"><td colspan="5" style="color:#1565c0;font-weight:700;">+ Government Grants (lump sum, not per ward)</td>';
            rows += '<td colspan="4"></td>';
            rows += '<td style="color:#1565c0;font-weight:700;">R' + tGr + 'M</td>';
            rows += '<td colspan="4"></td></tr>';
            // Grand total revenue
            rows += '<tr style="border-top:3px solid #333;"><td colspan="5" style="font-weight:800;font-size:14px;">Grand Total Revenue</td>';
            rows += '<td colspan="4"></td>';
            rows += '<td style="font-weight:800;font-size:14px;">R' + tRev + 'M</td>';
            rows += '<td colspan="4"></td></tr>';

            // Expenditure as a clean embedded table
            rows += '<tr><td colspan="14" style="padding:16px 6px 0;border:none;">';
            rows += '<table style="width:90%;border-collapse:collapse;font-size:13px;">';
            rows += '<tr><td colspan="4" style="font-weight:800;font-size:15px;padding:0 0 8px;border-bottom:2px solid #333;">Planned Expenditure (2025/26)</td></tr>';
            var expenses = [
                {name: 'Bulk purchases', detail: 'Pass-through \u2014 buys from Eskom (elec) & bulk water suppliers, resells at near-zero margin', amt: 470, pct: 33, color: '#f57c00'},
                {name: 'Employee costs', detail: '808 posts, 154 vacancies. 5% SALGA increase. Includes salaries, pension, medical, overtime', amt: 365, pct: 25, color: '#d32f2f'},
                {name: 'Other operating', detail: 'Repairs & maintenance, outsourced services, materials, insurance. Council projects R8.3M', amt: 260, pct: 18, color: '#555'},
                {name: 'Capital projects', detail: '72% to Technical Services (roads, water, sewerage). R40M borrowing for smart water meters. Chair: Arends W11', amt: 169, pct: 12, color: '#1565c0'},
                {name: 'Depreciation', detail: 'Non-cash \u2014 accounting charge for asset value reduction. No actual funds consumed', amt: 90, pct: 6, color: '#888'},
                {name: 'Finance charges', detail: 'Interest on borrowings. New R40M debt for smart water meters to address 33.7% water losses', amt: 30, pct: 2, color: '#888'},
            ];
            expenses.forEach(function(e) {
                var barW = Math.max(e.pct * 2.5, 4);
                rows += '<tr style="border-bottom:1px solid #eee;">';
                rows += '<td style="padding:5px 10px;color:' + e.color + ';font-weight:600;width:160px;">' + e.name + '</td>';
                rows += '<td style="padding:5px 10px;font-weight:700;text-align:right;width:80px;">R' + e.amt + 'M</td>';
                rows += '<td style="padding:5px 10px;width:160px;"><div style="display:flex;align-items:center;gap:6px;">';
                rows += '<div style="width:' + barW + 'px;height:16px;background:' + e.color + ';border-radius:3px;opacity:0.7;"></div>';
                rows += '<span style="color:#666;font-size:12px;">' + e.pct + '%</span></div></td>';
                rows += '<td style="padding:5px 10px;font-size:12px;color:#555;">' + e.detail + '</td>';
                rows += '</tr>';
            });
            rows += '<tr style="border-top:2px solid #333;">';
            rows += '<td style="padding:8px 10px;font-weight:800;">Total Expenditure</td>';
            rows += '<td style="padding:8px 10px;font-weight:800;text-align:right;">R1,384M</td>';
            rows += '<td style="padding:8px 10px;"><span style="color:#666;">97% of revenue</span></td>';
            rows += '<td></td></tr>';
            rows += '<tr style="background:rgba(46,125,50,0.08);border-radius:4px;">';
            rows += '<td style="padding:8px 10px;font-weight:800;color:#2e7d32;">Surplus</td>';
            rows += '<td style="padding:8px 10px;font-weight:800;text-align:right;color:#2e7d32;">R49M</td>';
            rows += '<td style="padding:8px 10px;color:#2e7d32;">3%</td>';
            rows += '<td style="font-size:12px;color:#666;">Council controls R794M (55%)</td></tr>';
            rows += '</table></td></tr>';
            dataTbody.innerHTML = rows;

            // Sortable headers
            var table = wardDataOverlay.querySelector('.kwm-data-table');
            if (table) {
                var headers = table.querySelectorAll('th');
                var sortDir = {};
                headers.forEach(function (th, colIdx) {
                    th.addEventListener('click', function () {
                        var tbody = table.querySelector('tbody');
                        var rowsArr = Array.from(tbody.querySelectorAll('tr:not(.kwm-data-total)'));
                        var totalRow = tbody.querySelector('.kwm-data-total');
                        var asc = sortDir[colIdx] !== 'asc';
                        sortDir[colIdx] = asc ? 'asc' : 'desc';
                        headers.forEach(function (h) { h.classList.remove('kwm-sort-asc', 'kwm-sort-desc'); });
                        th.classList.add(asc ? 'kwm-sort-asc' : 'kwm-sort-desc');
                        rowsArr.sort(function (a, b) {
                            var aVal = a.cells[colIdx].textContent.trim();
                            var bVal = b.cells[colIdx].textContent.trim();
                            var aNum = parseFloat(aVal.replace(/[R,M%\s]/g, ''));
                            var bNum = parseFloat(bVal.replace(/[R,M%\s]/g, ''));
                            if (!isNaN(aNum) && !isNaN(bNum)) return asc ? aNum - bNum : bNum - aNum;
                            return asc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
                        });
                        rowsArr.forEach(function (r) { tbody.appendChild(r); });
                        if (totalRow) tbody.appendChild(totalRow);
                    });
                });
            }

            wardDataBtn.addEventListener('click', function () { wardDataOverlay.style.display = 'flex'; });
            wardDataOverlay.addEventListener('click', function (e) { if (e.target === wardDataOverlay) wardDataOverlay.style.display = 'none'; });
            wardDataOverlay.querySelector('.kwm-ward-data-close').addEventListener('click', function () { wardDataOverlay.style.display = 'none'; });
        }

        // Council seats modal - build rich cards with images
        var councilBtn = document.getElementById('kwm-council-btn');
        var councilOverlay = document.getElementById('kwm-council-overlay');
        if (councilBtn && councilOverlay) {
            var prCouncillors = [
                {name: 'Andre van Schalkwyk', party: 'DA', color: '#005BA6', image: '', role: ''},
                {name: 'Luzuko Tyokolo', party: 'DA', color: '#005BA6', image: '', role: ''},
                {name: 'Jason White', party: 'DA', color: '#005BA6', image: '', role: ''},
                {name: 'Thando Matika', party: 'ANC', color: '#009933', image: '', role: 'Executive Mayor'},
                {name: 'Neil Louw', party: 'EFF', color: '#e4003b', image: '', role: 'Strategic Services & Housing Chair'},
                {name: 'Susan Campbell', party: 'KIM', color: '#8B4513', image: '', role: ''},
                {name: 'Mark Willemse', party: 'KIM', color: '#8B4513', image: '', role: 'Speaker'},
                {name: 'Beauty Charlie', party: 'PA', color: '#DAA520', image: '', role: ''},
                {name: 'Vacant', party: 'PA', color: '#DAA520', image: '', role: ''},
                {name: 'Morton Gericke', party: 'PBI', color: '#ff6600', image: '', role: 'Exec Deputy Mayor, Planning Chair'},
            ];

            function buildCouncilCard(num, name, party, color, image, type, role, ward) {
                var html = '<div class="kwm-council-card" style="background:' + color + ';cursor:pointer;" data-ward="' + (ward || '') + '" data-name="' + name + '" data-party="' + party + '">';
                if (image) {
                    html += '<img src="' + image + '" alt="' + name + '" class="kwm-council-img kwm-council-photo" style="display:none;">';
                }
                html += '<div class="kwm-council-card-name">' + name + '</div>';
                html += '<div class="kwm-council-card-party">' + party + '</div>';
                html += '<div class="kwm-council-card-type">' + type + '</div>';
                if (role) html += '<div class="kwm-council-card-role">' + role + '</div>';
                html += '</div>';
                return html;
            }

            function buildSeatPopup(wardNum, name, party) {
                var w = wardNum ? kwmData.wards[wardNum] : null;
                var html = '<div class="kwm-seat-popup">';
                html += '<div class="kwm-seat-popup-header">' + name + ' <span style="opacity:0.7;">(' + party + ')</span></div>';
                if (w && w.pr_votes) {
                    var votes = w.pr_votes;
                    var total = w.pr_total || 1;
                    var turnout = w.pr_turnout || '';
                    var parties = Object.keys(votes).sort(function(a,b){ return votes[b]-votes[a]; });
                    html += '<div class="kwm-seat-popup-title">Ward ' + wardNum + ': ' + total.toLocaleString() + ' PR votes &mdash; ' + turnout + '</div>';
                    html += '<div class="kwm-seat-popup-bar">';
                    parties.forEach(function(p) {
                        var pct = (votes[p]/total*100).toFixed(1);
                        var clr = partyColors[p] || '#999';
                        if (parseFloat(pct) > 2) {
                            html += '<div style="width:' + pct + '%;background:' + clr + ';height:20px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;text-shadow:0 1px 1px rgba(0,0,0,0.4);">' + (parseFloat(pct) > 8 ? p : '') + '</div>';
                        }
                    });
                    html += '</div>';
                    html += '<div class="kwm-seat-popup-list">';
                    parties.forEach(function(p) {
                        if (votes[p] > 0) {
                            var pct = (votes[p]/total*100).toFixed(1);
                            html += '<span><b style="color:' + (partyColors[p]||'#999') + ';">' + p + '</b> ' + votes[p].toLocaleString() + ' (' + pct + '%)</span> ';
                        }
                    });
                    html += '</div>';
                    if (w.areas) html += '<div style="font-size:11px;color:#888;margin-top:4px;">Areas: ' + (w.areas||[]).join(', ') + '</div>';
                    if (w.political_culture) html += '<div style="font-size:11px;margin-top:2px;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + (w.culture_color||'#999') + ';margin-right:3px;"></span>' + w.political_culture + '</div>';
                } else {
                    html += '<div style="font-size:12px;color:#888;margin-top:4px;">PR seat &mdash; elected from party list, not ward-specific</div>';
                }
                html += '</div>';
                return html;
            }

            var modalHtml = '<h4 style="margin:0 0 4px;color:#666;font-size:12px;">Ward Seats (11)</h4>';
            modalHtml += '<div class="kwm-council-cards">';
            var wkeys = Object.keys(kwmData.wards).sort(function(a,b){return parseInt(a)-parseInt(b);});
            wkeys.forEach(function(k) {
                var w = kwmData.wards[k];
                var roles = {
                    '4': 'Community Services Chair',
                    '5': 'Garden Route District Rep',
                    '6': 'Finance & Governance Chair',
                    '7': 'Council Whip',
                    '11': 'Infrastructure Chair, District Rep',
                };
                modalHtml += buildCouncilCard(k, (w.councillor||'').replace('Cllr ',''), w.party||'', w.party_color||partyColors[w.party]||'#999', w.image||'', 'Ward ' + k, roles[k]||'', k);
            });
            modalHtml += '</div>';

            modalHtml += '<h4 style="margin:16px 0 4px;color:#666;font-size:12px;">PR Seats (10)</h4>';
            modalHtml += '<div class="kwm-council-cards">';
            prCouncillors.forEach(function(c, i) {
                modalHtml += buildCouncilCard(12+i, c.name, c.party, c.color, c.image, 'PR', c.role, '');
            });
            modalHtml += '</div>';

            modalHtml += '<div id="kwm-seat-popup-container" class="kwm-seat-popup-container" style="display:none;"></div>';
            document.getElementById('kwm-council-modal-content').innerHTML = modalHtml;

            // Click handler for seat cards
            var seatPopup = document.getElementById('kwm-seat-popup-container');
            document.querySelectorAll('.kwm-council-card').forEach(function(card) {
                card.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var wardNum = this.getAttribute('data-ward');
                    var name = this.getAttribute('data-name');
                    var party = this.getAttribute('data-party');
                    seatPopup.innerHTML = buildSeatPopup(wardNum, name, party);
                    seatPopup.style.display = '';
                });
            });
            // Click popup to close it
            if (seatPopup) {
                seatPopup.addEventListener('click', function() { this.style.display = 'none'; });
            }

            councilBtn.addEventListener('click', function () { councilOverlay.style.display = 'flex'; });
            councilOverlay.addEventListener('click', function (e) { if (e.target === councilOverlay) councilOverlay.style.display = 'none'; });
            councilOverlay.querySelector('.kwm-council-close').addEventListener('click', function () { councilOverlay.style.display = 'none'; });

            // Photo toggle
            var photosCb = document.getElementById('kwm-council-photos');
            if (photosCb) {
                photosCb.addEventListener('change', function () {
                    var photos = councilOverlay.querySelectorAll('.kwm-council-photo');
                    photos.forEach(function (img) { img.style.display = photosCb.checked ? '' : 'none'; });
                });
            }
        }

        // REMOVED: Seat simulator
        var simToggle = document.getElementById('kwm-sim-toggle');
        var simPanel = document.getElementById('kwm-simulator');
        var simSliders = document.getElementById('kwm-sim-sliders');
        var simResult = document.getElementById('kwm-sim-result');
        var simReset = document.getElementById('kwm-sim-reset');

        if (simToggle && simPanel) {
            var prParties = ['ANC', 'DA', 'EFF', 'PA', 'KIM', 'PBI'];
            var wardSeats = { ANC: 6, DA: 5 };  // Ward ballot seats only
            var prSeats = 10;

            // Calculate actual 2021 PR totals across all wards
            var actual2021 = {};
            prParties.forEach(function (p) { actual2021[p] = 0; });
            Object.keys(kwmData.wards).forEach(function (k) {
                var v = kwmData.wards[k].pr_votes || {};
                prParties.forEach(function (p) { actual2021[p] += (v[p] || 0); });
            });
            var totalPR = 0;
            prParties.forEach(function (p) { totalPR += actual2021[p]; });

            // Use actual vote counts for precision — sliders show %
            var simVotes = {};
            prParties.forEach(function (p) { simVotes[p] = actual2021[p]; });

            var pClr = { ANC: '#009933', DA: '#005BA6', EFF: '#e4003b', PA: '#DAA520', KIM: '#8B4513', PBI: '#ff6600' };

            function pct(p) { return totalPR > 0 ? (simVotes[p] / totalPR * 100).toFixed(1) : '0'; }

            function buildSliders() {
                var html = '';
                prParties.forEach(function (p) {
                    var val = Math.round(simVotes[p] / totalPR * 100);
                    html += '<div class="kwm-sim-slider">';
                    html += '<label style="color:' + pClr[p] + ';">' + p + '</label>';
                    html += '<input type="range" min="0" max="80" value="' + val + '" data-party="' + p + '" style="accent-color:' + pClr[p] + ';">';
                    html += '<span class="kwm-sim-val" id="kwm-sv-' + p + '">' + pct(p) + '%</span>';
                    html += '</div>';
                });
                simSliders.innerHTML = html;

                simSliders.querySelectorAll('input[type="range"]').forEach(function (s) {
                    s.addEventListener('input', function () {
                        var changed = this.getAttribute('data-party');
                        var newPct = parseInt(this.value);
                        var newVotes = Math.round(totalPR * newPct / 100);
                        var oldVotes = simVotes[changed];
                        var diff = newVotes - oldVotes;

                        if (diff === 0) return;

                        simVotes[changed] = newVotes;

                        // Redistribute diff proportionally among other parties
                        var others = prParties.filter(function (p) { return p !== changed && simVotes[p] > 0; });
                        var othersTotal = 0;
                        others.forEach(function (p) { othersTotal += simVotes[p]; });

                        if (othersTotal > 0 && diff > 0) {
                            var remaining = diff;
                            others.forEach(function (p) {
                                var share = Math.round((simVotes[p] / othersTotal) * diff);
                                share = Math.min(share, simVotes[p]);
                                simVotes[p] -= share;
                                remaining -= share;
                            });
                            for (var i = 0; remaining > 0 && i < others.length; i++) {
                                if (simVotes[others[i]] > 0) {
                                    simVotes[others[i]]--;
                                    remaining--;
                                }
                            }
                        } else if (othersTotal >= 0 && diff < 0) {
                            var toAdd = -diff;
                            if (othersTotal > 0) {
                                others.forEach(function (p) {
                                    var share = Math.round((simVotes[p] / othersTotal) * toAdd);
                                    simVotes[p] += share;
                                });
                            } else {
                                if (others.length > 0) simVotes[others[0]] += toAdd;
                            }
                        }

                        // Clamp all to 0+
                        prParties.forEach(function (p) { if (simVotes[p] < 0) simVotes[p] = 0; });

                        // Update all sliders and labels
                        simSliders.querySelectorAll('input[type="range"]').forEach(function (sl) {
                            var p = sl.getAttribute('data-party');
                            sl.value = Math.round(simVotes[p] / totalPR * 100);
                            document.getElementById('kwm-sv-' + p).textContent = pct(p) + '%';
                        });

                        updateSimResult();
                    });
                });
            }

            function calcPRSeats(votes, seats) {
                // Hare quota largest remainder (SA local government method)
                var total = 0;
                var parties = Object.keys(votes).filter(function (p) { return p !== 'Other' && votes[p] > 0; });
                parties.forEach(function (p) { total += votes[p]; });
                if (total === 0) return {};

                var quota = total / seats;
                var allocated = {};
                var remainders = {};
                var used = 0;

                parties.forEach(function (p) {
                    allocated[p] = Math.floor(votes[p] / quota);
                    remainders[p] = votes[p] - (allocated[p] * quota);
                    used += allocated[p];
                });

                // Distribute remaining seats by largest remainder
                var remaining = seats - used;
                var sorted = parties.slice().sort(function (a, b) { return remainders[b] - remainders[a]; });
                for (var i = 0; i < remaining && i < sorted.length; i++) {
                    allocated[sorted[i]]++;
                }

                return allocated;
            }

            function updateSimResult() {
                var prAlloc = calcPRSeats(simVotes, prSeats);

                var totalSeats = {};
                prParties.forEach(function (p) {
                    totalSeats[p] = (wardSeats[p] || 0) + (prAlloc[p] || 0);
                });

                // Build result bar
                var html = '';
                var sorted = prParties.slice().sort(function (a, b) { return (totalSeats[b] || 0) - (totalSeats[a] || 0); });
                sorted.forEach(function (p) {
                    var s = totalSeats[p] || 0;
                    if (s > 0) {
                        var w = wardSeats[p] || 0;
                        var pr = prAlloc[p] || 0;
                        html += '<div class="kwm-sim-seat" style="flex:' + s + ';background:' + pClr[p] + ';">' + p + ' ' + s + ' (' + w + 'W+' + pr + 'PR)</div>';
                    }
                });

                var govCoal = (totalSeats['ANC'] || 0) + (totalSeats['KIM'] || 0) + (totalSeats['PBI'] || 0) + (totalSeats['EFF'] || 0);
                var oppCoal = (totalSeats['DA'] || 0) + (totalSeats['PA'] || 0);
                html += '<div style="color:#ccc;font-size:10px;display:flex;align-items:center;margin-left:8px;white-space:nowrap;">';
                html += 'Gov (ANC+KIM+PBI+EFF): ' + govCoal + ' | Opp (DA+PA): ' + oppCoal + ' | Need: 11';
                html += '</div>';

                simResult.innerHTML = html;
            }

            var originalPRCards = [];
            document.querySelectorAll('.kwm-seat-pr').forEach(function (el) {
                originalPRCards.push({
                    clr: el.style.getPropertyValue('--clr'),
                    name: el.querySelector('.kwm-seat-name').textContent,
                    tag: el.querySelector('.kwm-seat-tag').textContent,
                    num: el.querySelector('.kwm-seat-num').textContent,
                });
            });

            function restorePRCards() {
                var prGrid = document.querySelectorAll('.kwm-seat-pr');
                prGrid.forEach(function (el, idx) {
                    if (idx < originalPRCards.length) {
                        el.style.setProperty('--clr', originalPRCards[idx].clr);
                        el.querySelector('.kwm-seat-name').textContent = originalPRCards[idx].name;
                        el.querySelector('.kwm-seat-tag').textContent = originalPRCards[idx].tag;
                        el.querySelector('.kwm-seat-num').textContent = originalPRCards[idx].num;
                        el.style.display = '';
                    }
                });
            }

            simToggle.addEventListener('click', function (e) {
                e.preventDefault();
                if (simPanel.style.display === 'none') {
                    simPanel.style.display = '';
                    buildSliders();
                    // Don't run updateSimResult on open - PR cards stay as 2021 actuals
                    // Only update when user drags a slider
                    this.textContent = 'Hide Simulator';
                } else {
                    simPanel.style.display = 'none';
                    this.innerHTML = 'Seat Simulator &rarr;';
                    restorePRCards();
                }
            });

            if (simReset) {
                simReset.addEventListener('click', function () {
                    prParties.forEach(function (p) {
                        simVotes[p] = actual2021[p];
                    });
                    buildSliders();
                    restorePRCards();
                });
            }
        }

        // Sources popup
        var infoBtn = document.getElementById('kwm-info-btn');
        var sourcesOverlay = document.getElementById('kwm-sources-overlay');
        if (infoBtn && sourcesOverlay) {
            infoBtn.addEventListener('click', function () {
                sourcesOverlay.style.display = 'flex';
            });
            sourcesOverlay.addEventListener('click', function (e) {
                if (e.target === sourcesOverlay) sourcesOverlay.style.display = 'none';
            });
            sourcesOverlay.querySelector('.kwm-sources-close').addEventListener('click', function () {
                sourcesOverlay.style.display = 'none';
            });
        }

        // Fiscal methodology popup
        var fiscalBtn = document.getElementById('kwm-fiscal-btn');
        var fiscalOverlay = document.getElementById('kwm-fiscal-overlay');
        if (fiscalBtn && fiscalOverlay) {
            fiscalBtn.addEventListener('click', function () {
                fiscalOverlay.style.display = 'flex';
            });
            fiscalOverlay.addEventListener('click', function (e) {
                if (e.target === fiscalOverlay) fiscalOverlay.style.display = 'none';
            });
            fiscalOverlay.querySelector('.kwm-fiscal-close').addEventListener('click', function () {
                fiscalOverlay.style.display = 'none';
            });
        }

        // Budget breakdown popup
        var budgetBtn = document.getElementById('kwm-budget-btn');
        var budgetOverlay = document.getElementById('kwm-budget-overlay');
        if (budgetBtn && budgetOverlay) {
            budgetBtn.addEventListener('click', function () {
                budgetOverlay.style.display = 'flex';
            });
            budgetOverlay.addEventListener('click', function (e) {
                if (e.target === budgetOverlay) budgetOverlay.style.display = 'none';
            });
            budgetOverlay.querySelector('.kwm-budget-close').addEventListener('click', function () {
                budgetOverlay.style.display = 'none';
            });
        }

        // Political Culture legend
        var cultureBtn = document.getElementById('kwm-culture-btn');
        if (cultureBtn) {
            var cultures = [
                { name: 'Deep contractual',    color: '#1565c0', desc: 'Voters hold council to account on service delivery. Performance determines electoral outcomes. Strong civic expectations.' },
                { name: 'Contractual-leaning', color: '#0288d1', desc: 'Accountability is growing. Voters are increasingly performance-oriented but loyalty still plays a role.' },
                { name: 'Transitional',        color: '#fbc02d', desc: 'Genuinely competitive ward. Mixed voter base — neither pure patronage nor pure accountability dominates.' },
                { name: 'Patronage-leaning',   color: '#f57c00', desc: 'Party/ethnic loyalty matters more than delivery. Voters tend to reward affiliation over performance.' },
                { name: 'Deep patronage',      color: '#d32f2f', desc: 'Patron-client dynamics dominate. Access to services/resources is channelled through party loyalty. Weak accountability.' },
            ];
            var cultureOverlay = document.createElement('div');
            cultureOverlay.className = 'kwm-sources-overlay';
            cultureOverlay.style.display = 'none';
            var cRows = cultures.map(function (c) {
                return '<div class="kwm-culture-legend-row">' +
                    '<div class="kwm-culture-legend-dot" style="background:' + c.color + ';"></div>' +
                    '<div><strong style="color:' + c.color + ';">' + c.name + '</strong><p>' + c.desc + '</p></div>' +
                    '</div>';
            }).join('');
            cultureOverlay.innerHTML = '<div class="kwm-sources-modal">' +
                '<button class="kwm-sources-close">&times;</button>' +
                '<h3>Political Culture</h3>' +
                '<p class="kwm-sources-intro">Wards are classified by their dominant political culture — the relationship between voters and their elected representative. Switch "Color by" to <strong>Political Culture</strong> to see this on the map.</p>' +
                cRows +
                '</div>';
            document.body.appendChild(cultureOverlay);
            cultureBtn.addEventListener('click', function () {
                cultureOverlay.style.display = 'flex';
            });
            cultureOverlay.addEventListener('click', function (e) {
                if (e.target === cultureOverlay) cultureOverlay.style.display = 'none';
            });
            cultureOverlay.querySelector('.kwm-sources-close').addEventListener('click', function () {
                cultureOverlay.style.display = 'none';
            });
        }
    }

    function init() {
        var mapEl = document.getElementById('kwm-map');
        if (!mapEl) return;

        map = L.map('kwm-map', {
            center: defaultCenter,
            zoom: defaultZoom,
            scrollWheelZoom: true,
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Knysna Municipality Ward Map',
            maxZoom: 19,
        }).addTo(map);

        map.on('popupclose', function () {
            activePopupWard = null;
        });

        // Add all wards
        var keys = Object.keys(kwmData.wards).sort(function (a, b) { return parseInt(a) - parseInt(b); });
        keys.forEach(function (key) {
            addWard(key, kwmData.wards[key]);
        });

        populateSelect();
        addWardFilters();
        setupToggles();

        // Default ward or show all
        if (kwmData.defaultWard && kwmData.wards[kwmData.defaultWard]) {
            document.getElementById('kwm-ward-select').value = kwmData.defaultWard;
            focusWard(kwmData.defaultWard);
        } else {
            resetView();
        }

        // Reset button
        var resetBtn = document.getElementById('kwm-reset-view');
        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                document.getElementById('kwm-ward-select').value = 'all';
                document.getElementById('kwm-ward-info').innerHTML = '';
                resetView();
            });
        }

        // Controls collapse toggle
        var ctrlToggle = document.getElementById('kwm-controls-toggle');
        var ctrlPanel = document.getElementById('kwm-controls');
        if (ctrlToggle && ctrlPanel) {
            // Auto-collapse on small screens
            if (window.innerWidth <= 640) {
                ctrlPanel.classList.add('collapsed');
            }
            ctrlToggle.addEventListener('click', function () {
                ctrlPanel.classList.toggle('collapsed');
                map.invalidateSize();
            });
        }

    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
