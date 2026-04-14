<?php
/**
 * Plugin Name: Knysna Wards Map
 * Description: Interactive map displaying Knysna Municipality ward boundaries and points of interest.
 * Version: 1.2.0
 * Author: KIG
 * License: GPL v2 or later
 */

if (!defined('ABSPATH')) {
    exit;
}

define('KWM_PLUGIN_URL', plugin_dir_url(__FILE__));
define('KWM_PLUGIN_DIR', plugin_dir_path(__FILE__));

class Knysna_Wards_Map {

    const PAGE_SLUG = 'knysna-wards-map';

    public function __construct() {
        add_shortcode('knysna_wards_map', [$this, 'render_map']);
        add_action('wp_enqueue_scripts', [$this, 'register_assets']);
        add_action('wp_ajax_kwm_get_ward_data', [$this, 'ajax_get_ward_data']);
        add_action('wp_ajax_nopriv_kwm_get_ward_data', [$this, 'ajax_get_ward_data']);
        add_action('wp_ajax_kwm_save_ward', [$this, 'ajax_save_ward']);
        add_filter('template_include', [$this, 'maybe_load_fullwidth_template']);
        add_action('admin_menu', [$this, 'add_admin_menu']);
        add_action('admin_init', [$this, 'redirect_view_map']);

        register_activation_hook(__FILE__, [$this, 'on_activate']);
    }

    /**
     * On activation, create the dedicated map page.
     */
    public function on_activate() {
        if (!get_page_by_path(self::PAGE_SLUG)) {
            wp_insert_post([
                'post_title'   => 'Knysna Wards Map',
                'post_name'    => self::PAGE_SLUG,
                'post_content' => '[knysna_wards_map height="calc(100vh - 120px)" zoom="13"]',
                'post_status'  => 'publish',
                'post_type'    => 'page',
                'post_author'  => 1,
            ]);
        }
        flush_rewrite_rules();
    }

    /**
     * Load a minimal full-width template for the map page.
     */
    public function maybe_load_fullwidth_template($template) {
        if (is_page(self::PAGE_SLUG)) {
            $custom = KWM_PLUGIN_DIR . 'templates/fullwidth-map.php';
            if (file_exists($custom)) {
                return $custom;
            }
        }
        return $template;
    }

    public function register_assets() {
        wp_register_style('leaflet', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', [], '1.9.4');
        wp_register_script('leaflet', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', [], '1.9.4', true);
        wp_register_script('esri-leaflet', 'https://unpkg.com/esri-leaflet@3.0.12/dist/esri-leaflet.js', ['leaflet'], '3.0.12', true);
        $ver = filemtime(KWM_PLUGIN_DIR . 'assets/kwm-map.js');
        wp_register_style('kwm-style', KWM_PLUGIN_URL . 'assets/kwm-style.css', ['leaflet'], $ver);
        wp_register_script('kwm-map', KWM_PLUGIN_URL . 'assets/kwm-map.js', ['leaflet', 'esri-leaflet'], $ver, true);
    }

    public function render_map($atts) {
        $atts = shortcode_atts([
            'ward'   => '',
            'height' => '600px',
            'zoom'   => 13,
        ], $atts);

        wp_enqueue_style('leaflet');
        wp_enqueue_script('leaflet');
        wp_enqueue_script('esri-leaflet');
        wp_enqueue_style('kwm-style');
        wp_enqueue_script('kwm-map');

        wp_localize_script('kwm-map', 'kwmData', [
            'ajaxUrl'     => admin_url('admin-ajax.php'),
            'nonce'       => wp_create_nonce('kwm_nonce'),
            'defaultWard' => sanitize_text_field($atts['ward']),
            'zoom'        => intval($atts['zoom']),
            'wards'       => self::get_all_wards(),
            'logosUrl'    => KWM_PLUGIN_URL . 'assets/logos/',
        ]);

        $height = esc_attr($atts['height']);

        ob_start();
        ?>
        <div class="kwm-container">
            <div class="kwm-controls" id="kwm-controls">
                <div class="kwm-controls-header">
                    <a class="kwm-back-arrow" href="<?php echo esc_url(home_url('/')); ?>" title="Back to <?php bloginfo('name'); ?>">&larr;</a>
                    <h2 class="kwm-title">Knysna Municipality Ward Map</h2>
                    <span id="kwm-ward-data-btn" class="kwm-info-btn" title="Ward Data Table">&#9776;</span>
                    <span id="kwm-council-btn" class="kwm-info-btn" title="Council Seats">&#9733;</span>
                    <span id="kwm-info-btn" class="kwm-info-btn" title="Sources">&#9432;</span>
                    <span id="kwm-fiscal-btn" class="kwm-info-btn" title="Fiscal Methodology">R</span>
                    <span id="kwm-budget-btn" class="kwm-info-btn" title="Budget Breakdown">B</span>
                    <span id="kwm-culture-btn" class="kwm-info-btn" title="Political Culture Legend">C</span>
                    <button id="kwm-controls-toggle" class="kwm-controls-toggle" title="Toggle controls">&#8963;</button>
                </div>
                <div class="kwm-controls-body" id="kwm-controls-body">
                <div class="kwm-controls-inner">
                    <label for="kwm-ward-select">Select Ward:</label>
                    <select id="kwm-ward-select">
                        <option value="all">All Wards</option>
                    </select>
                    <button id="kwm-reset-view" class="kwm-btn">Reset View</button>
                    <label for="kwm-color-mode">Color by:</label>
                    <select id="kwm-color-mode">
                        <option value="ward">Ward</option>
                        <option value="culture">Political Culture</option>
                        <option value="election">Election 2021</option>
                    </select>
                </div>
                <div class="kwm-filter-row">
                    <div class="kwm-ward-filters" id="kwm-ward-filters"></div>
                    <div class="kwm-toggles">
                        <label class="kwm-toggle"><input type="checkbox" id="kwm-toggle-labels" checked> Labels</label>
                        <label class="kwm-toggle"><input type="checkbox" id="kwm-toggle-fiscal"> Revenue</label>
                        <label class="kwm-toggle"><input type="checkbox" id="kwm-toggle-capex"> CapEx</label>
                        <label class="kwm-toggle"><input type="checkbox" id="kwm-toggle-votes"> Votes</label>
                        <label class="kwm-toggle"><input type="checkbox" id="kwm-toggle-election"> PR Charts</label>
                        <label class="kwm-toggle"><input type="checkbox" id="kwm-toggle-party" checked> Party Icons</label>
                        <label class="kwm-toggle"><input type="checkbox" id="kwm-toggle-top-parties"> Top 3 Parties</label>
                        <label class="kwm-toggle"><input type="checkbox" id="kwm-toggle-cadastral"> Cadastral</label>
                        <label class="kwm-toggle"><input type="checkbox" id="kwm-toggle-poi"> POI</label>
                    </div>
                </div>
                </div><!-- /.kwm-controls-body -->
                <div id="kwm-council-bar" style="display:none;">
                <div class="kwm-council-inner">
                    <span class="kwm-council-subtitle">Gov: ANC 7 + KIM 2 + PBI 1 + EFF 1 = 11 | Opp: DA 8 + PA 2 = 10</span>
                    <span class="kwm-row-label">Ward Seats (11)</span>
                    <div class="kwm-council-grid">
                        <div class="kwm-seat" style="--clr:#005BA6;"><span class="kwm-seat-num">1</span><span class="kwm-seat-name">Davis</span><span class="kwm-seat-tag">DA</span></div>
                        <div class="kwm-seat" style="--clr:#005BA6;"><span class="kwm-seat-num">2</span><span class="kwm-seat-name">Vanston</span><span class="kwm-seat-tag">DA</span></div>
                        <div class="kwm-seat" style="--clr:#009933;"><span class="kwm-seat-num">3</span><span class="kwm-seat-name">Nohana</span><span class="kwm-seat-tag">ANC</span></div>
                        <div class="kwm-seat" style="--clr:#009933;"><span class="kwm-seat-num">4</span><span class="kwm-seat-name">Petros</span><span class="kwm-seat-tag">ANC</span><span class="kwm-seat-role" title="Community Services Committee Chair | Garden Route District Rep">&#9733;</span></div>
                        <div class="kwm-seat" style="--clr:#005BA6;"><span class="kwm-seat-num">5</span><span class="kwm-seat-name">Stroebel</span><span class="kwm-seat-tag">DA</span><span class="kwm-seat-role" title="Garden Route District Rep">&#9733;</span></div>
                        <div class="kwm-seat" style="--clr:#009933;"><span class="kwm-seat-num">6</span><span class="kwm-seat-name">Andrews</span><span class="kwm-seat-tag">ANC</span><span class="kwm-seat-role" title="Finance &amp; Governance Committee Chair">&#9733;</span></div>
                        <div class="kwm-seat" style="--clr:#009933;"><span class="kwm-seat-num">7</span><span class="kwm-seat-name">Khumelwana</span><span class="kwm-seat-tag">ANC</span><span class="kwm-seat-role" title="Council Whip">&#9733;</span></div>
                        <div class="kwm-seat" style="--clr:#009933;"><span class="kwm-seat-num">8</span><span class="kwm-seat-name">Tsengwa</span><span class="kwm-seat-tag">ANC</span></div>
                        <div class="kwm-seat" style="--clr:#005BA6;"><span class="kwm-seat-num">9</span><span class="kwm-seat-name">Sabbagh</span><span class="kwm-seat-tag">DA</span></div>
                        <div class="kwm-seat" style="--clr:#005BA6;"><span class="kwm-seat-num">10</span><span class="kwm-seat-name">Bester</span><span class="kwm-seat-tag">DA</span></div>
                        <div class="kwm-seat" style="--clr:#009933;"><span class="kwm-seat-num">11</span><span class="kwm-seat-name">Arends</span><span class="kwm-seat-tag">ANC</span><span class="kwm-seat-role" title="Infrastructure Services Committee Chair | Garden Route District Rep">&#9733;</span></div>
                    </div>
                    <span class="kwm-row-label">PR Seats (10)</span>
                    <div class="kwm-council-grid">
                        <div class="kwm-seat kwm-seat-pr" style="--clr:#005BA6;"><span class="kwm-seat-num">12</span><span class="kwm-seat-name">v Schalkwyk</span><span class="kwm-seat-tag">DA</span></div>
                        <div class="kwm-seat kwm-seat-pr" style="--clr:#005BA6;"><span class="kwm-seat-num">13</span><span class="kwm-seat-name">Tyokolo</span><span class="kwm-seat-tag">DA</span></div>
                        <div class="kwm-seat kwm-seat-pr" style="--clr:#005BA6;"><span class="kwm-seat-num">14</span><span class="kwm-seat-name">White</span><span class="kwm-seat-tag">DA</span></div>
                        <div class="kwm-seat kwm-seat-pr" style="--clr:#009933;"><span class="kwm-seat-num">15</span><span class="kwm-seat-name">Matika</span><span class="kwm-seat-tag">ANC</span><span class="kwm-seat-role" title="Executive Mayor">&#9733;</span></div>
                        <div class="kwm-seat kwm-seat-pr" style="--clr:#e4003b;"><span class="kwm-seat-num">16</span><span class="kwm-seat-name">Louw</span><span class="kwm-seat-tag">EFF</span><span class="kwm-seat-role" title="Strategic Services &amp; Housing Committee Chair">&#9733;</span></div>
                        <div class="kwm-seat kwm-seat-pr" style="--clr:#8B4513;"><span class="kwm-seat-num">17</span><span class="kwm-seat-name">Campbell</span><span class="kwm-seat-tag">KIM</span></div>
                        <div class="kwm-seat kwm-seat-pr" style="--clr:#8B4513;"><span class="kwm-seat-num">18</span><span class="kwm-seat-name">Willemse</span><span class="kwm-seat-tag">KIM</span><span class="kwm-seat-role" title="Speaker">&#9733;</span></div>
                        <div class="kwm-seat kwm-seat-pr" style="--clr:#DAA520;"><span class="kwm-seat-num">19</span><span class="kwm-seat-name">Charlie</span><span class="kwm-seat-tag">PA</span></div>
                        <div class="kwm-seat kwm-seat-pr" style="--clr:#DAA520;"><span class="kwm-seat-num">20</span><span class="kwm-seat-name">Kakora</span><span class="kwm-seat-tag">PA</span></div>
                        <div class="kwm-seat kwm-seat-pr" style="--clr:#ff6600;"><span class="kwm-seat-num">21</span><span class="kwm-seat-name">Gericke</span><span class="kwm-seat-tag">PBI</span><span class="kwm-seat-role" title="Executive Deputy Mayor | Planning &amp; Economic Dev Committee Chair">&#9733;</span></div>
                    </div>
                </div>
                </div>
            </div>
            <div id="kwm-map" style="height: <?php echo $height; ?>;"></div>
            <div id="kwm-ward-data-overlay" class="kwm-sources-overlay" style="display:none;">
                <div class="kwm-sources-modal" style="max-width:80%;width:80%;">
                    <button class="kwm-ward-data-close kwm-sources-close">&times;</button>
                    <h3>Ward Data</h3>
                    <table class="kwm-data-table">
                        <thead>
                            <tr>
                                <th title="Ward number (1-11)">Ward</th>
                                <th title="Geographic areas within the ward">Areas</th>
                                <th title="Elected ward councillor">Councillor</th>
                                <th title="Political party of the councillor">Party</th>
                                <th title="Political culture classification of the ward's voter base">Culture</th>
                                <th style="color:#2e7d32;" title="Own Revenue: Rates + fines + rental + interest. 100% margin — no cost of sales. This is pure income.">Own Revenue<br><small>100% margin</small></th>
                                <th style="color:#2e7d32;" title="Property Rates only: Levied on property values at ~0.83%.">Rates<br><small>100% margin</small></th>
                                <th style="color:#f57c00;" title="Gross billed to consumers. Elec: -1% margin (R466M in, R470M to Eskom = loss). Water: 29% margin. Sewerage: 37% margin. Refuse: 26% margin. Blended: ~14% margin.">Services Billed<br><small>~14% margin</small></th>
                                <th style="color:#f57c00;" title="What the municipality keeps after paying Eskom and bulk suppliers. Electricity is a loss (-1%). Water (29%), sewerage (37%), refuse (26%) have margins.">Net Margin<br><small>kept after cost</small></th>
                                <th title="Total estimated revenue from all sources. Reconciled to R1,433M budget.">Total Rev<br><small>gross</small></th>
                                <th style="color:#2e7d32;font-weight:800;" title="Net Cash = Own Revenue (100% margin) + Service Margin (~14%). This is what the municipality actually earns after paying Eskom and bulk suppliers. Excludes grants.">Net Cash Earned<br><small>own + margin</small></th>
                                <th title="Capital Expenditure: Infrastructure projects 2025/26 from Annexure C. Roads, water, sewerage, housing.">CapEx<br><small>(projects)</small></th>
                                <th title="PR (Proportional Representation) votes cast in the 2021 local government election. Real data from IEC voting district results.">PR Votes</th>
                                <th title="Percentage of total municipal PR votes cast in this ward.">Vote %</th>
                            </tr>
                        </thead>
                        <tbody id="kwm-data-tbody"></tbody>
                    </table>
                </div>
            </div>
            <div id="kwm-council-overlay" class="kwm-sources-overlay" style="display:none;">
                <div class="kwm-sources-modal" style="max-width:80%;width:80%;">
                    <button class="kwm-council-close kwm-sources-close">&times;</button>
                    <h3>Knysna Council &mdash; 21 Seats</h3>
                    <p style="color:#666;font-size:12px;margin:0 0 10px;">Governing: ANC 7 + KIM 2 + PBI 1 + EFF 1 = 11 | Opposition: DA 8 + PA 2 = 10</p>
                    <label style="font-size:12px;cursor:pointer;margin-bottom:8px;display:inline-flex;align-items:center;gap:4px;"><input type="checkbox" id="kwm-council-photos"> Show photos</label>
                    <div id="kwm-council-modal-content"></div>
                </div>
            </div>
            <div id="kwm-sources-overlay" class="kwm-sources-overlay" style="display:none;">
                <div class="kwm-sources-modal">
                    <button class="kwm-sources-close">&times;</button>
                    <h3>Sources &amp; References</h3>
                    <p class="kwm-sources-intro">Political culture classifications, ward analysis, and electoral data are informed by the following sources.</p>
                    <h4>Academic &amp; Research</h4>
                    <ul>
                        <li>Schulz-Herzenberg, C. &mdash; <em>Players, Politics and Prospects: South Africa's 2021 Local Government Elections</em> (HSRC Press)</li>
                        <li>Piper, L. &amp; Deacon, R. &mdash; Ward committee research and local democracy studies</li>
                        <li>Tapscott, C. &mdash; <em>The Politics of Service Delivery</em> (HSRC Press)</li>
                        <li>Sobek, D. &amp; Booysen, S. &mdash; Research on municipal governance and coalition politics</li>
                    </ul>
                    <h4>On Patronage &amp; Political Economy</h4>
                    <ul>
                        <li>von Holdt, K. &mdash; <em>The Smoke that Calls</em> (Wits University Press)</li>
                        <li>Beresford, A. &mdash; <em>South Africa's Political Crisis</em> (Palgrave Macmillan)</li>
                        <li>Lodge, T. &mdash; <em>Politics in South Africa: From Mandela to Mbeki</em></li>
                    </ul>
                    <h4>Institutional Data</h4>
                    <ul>
                        <li>IEC (Independent Electoral Commission) &mdash; 2021 LGE election results</li>
                        <li>Municipal Demarcation Board &mdash; Ward boundary demarcations</li>
                        <li>SALGA &mdash; Local government structures and committee data</li>
                        <li>StatsSA &mdash; Census and Community Survey population data</li>
                        <li>Knysna Municipality &mdash; Councillor information (knysna.gov.za)</li>
                    </ul>
                    <h4>Political Analysis &amp; Journalism</h4>
                    <ul>
                        <li>Daily Maverick / Scorpio &mdash; Investigative journalism on local government</li>
                        <li>ISS (Institute for Security Studies) &mdash; Governance and accountability analysis</li>
                        <li>MISTRA (Mapungubwe Institute) &mdash; Political economy research</li>
                        <li>Afrobarometer &mdash; Public opinion survey data on governance and service delivery</li>
                    </ul>
                    <h4>Geospatial Data</h4>
                    <ul>
                        <li>OpenStreetMap / Nominatim &mdash; Ward boundary polygons</li>
                        <li>Knysna Municipality GIS &mdash; Ward maps (Feb 2022)</li>
                    </ul>
                    <p class="kwm-sources-note">Political culture classifications are analytical interpretations based on electoral patterns, not official designations.</p>
                </div>
            </div>
            <div id="kwm-fiscal-overlay" class="kwm-sources-overlay" style="display:none;">
                <div class="kwm-sources-modal">
                    <button class="kwm-fiscal-close kwm-sources-close">&times;</button>
                    <h3>Fiscal Contribution Methodology</h3>
                    <p class="kwm-sources-intro">Ward-level revenue estimates are derived from official budget data and the municipal valuation roll. These are estimates, not audited figures.</p>
                    <h4>Data Sources</h4>
                    <ul>
                        <li><strong>Knysna MTREF Budget 2025/26</strong> &mdash; Total operating revenue: R1,433M</li>
                        <li><strong>General Valuation Roll 2023-2028</strong> &mdash; 23,666 properties, R41.2B total value (knysna.gov.za)</li>
                    </ul>
                    <h4>Step 1: Property Values by Ward</h4>
                    <ul>
                        <li>The valuation roll lists each property with a <strong>DEEDS TOWN</strong> column (Belvidere, Sedgefield, Karatara, Rheenendal, etc.)</li>
                        <li>These areas were mapped directly to wards where possible</li>
                        <li>The large &ldquo;KNYSNA&rdquo; bucket (R27.4B, 16,005 properties) covers the central wards (2,3,6,7,8,9,10) and was split using property type concentrations &mdash; luxury/tourism properties assigned to Wards 9/10, low-cost housing to Wards 3/7</li>
                    </ul>
                    <h4>Step 2: Revenue Estimation</h4>
                    <ul>
                        <li><strong>Property rates (R362M)</strong>: Distributed proportional to property values per ward</li>
                        <li><strong>Electricity (R466M)</strong>: Weighted to high-value wards (commercial consumption higher)</li>
                        <li><strong>Water (R113M)</strong>: Proportional to property values</li>
                        <li><strong>Government grants (R254M)</strong>: Inversely weighted &mdash; indigent wards receive more equitable share allocation</li>
                        <li><strong>Other revenue (R238M)</strong>: Proportional to property values</li>
                    </ul>
                    <h4>Key Limitations</h4>
                    <ul>
                        <li>The &ldquo;KNYSNA&rdquo; DEEDS TOWN split across central wards is estimated, not verified</li>
                        <li>Electricity and water consumption per ward is not publicly available</li>
                        <li>Indigent register counts per ward are estimated from area characteristics</li>
                        <li>Actual billing data (who pays vs who is exempt) would significantly improve accuracy</li>
                    </ul>
                    <p class="kwm-sources-note">For verified ward-level fiscal data, request billing summaries from the Finance Directorate (chaired by Cllr Andrews, Ward 6).</p>
                </div>
            </div>
            <div id="kwm-budget-overlay" class="kwm-sources-overlay" style="display:none;">
                <div class="kwm-sources-modal">
                    <button class="kwm-budget-close kwm-sources-close">&times;</button>
                    <h3>Knysna Municipality Budget 2025/26</h3>
                    <p class="kwm-sources-intro">Source: Final 2025/2026 MTREF Budget Report (knysna.gov.za)</p>
                    <h4>Revenue &mdash; R1,433M</h4>
                    <table class="kwm-budget-table">
                        <tr style="background:#e8f5e9;"><td colspan="3" style="font-weight:700;color:#2e7d32;font-size:11px;">SERVICE CHARGES (sold to residents &amp; businesses)</td></tr>
                        <tr><td>Electricity sales to consumers</td><td class="kwm-bt-val">R466M</td><td class="kwm-bt-pct">33%</td></tr>
                        <tr><td>Water sales to consumers</td><td class="kwm-bt-val">R113M</td><td class="kwm-bt-pct">8%</td></tr>
                        <tr><td>Waste water (sewerage charges)</td><td class="kwm-bt-val">R79M</td><td class="kwm-bt-pct">6%</td></tr>
                        <tr><td>Waste management (refuse removal)</td><td class="kwm-bt-val">R47M</td><td class="kwm-bt-pct">3%</td></tr>
                        <tr style="background:#e3f2fd;"><td colspan="3" style="font-weight:700;color:#1565c0;font-size:11px;">OWN REVENUE (rates &amp; other)</td></tr>
                        <tr><td>Property rates (levied on property values)</td><td class="kwm-bt-val">R362M</td><td class="kwm-bt-pct">25%</td></tr>
                        <tr><td>Fines, penalties, forfeits</td><td class="kwm-bt-val">R103M</td><td class="kwm-bt-pct">7%</td></tr>
                        <tr><td>Rental from fixed assets</td><td class="kwm-bt-val">R9M</td><td class="kwm-bt-pct">1%</td></tr>
                        <tr style="background:#fff3e0;"><td colspan="3" style="font-weight:700;color:#e65100;font-size:11px;">GOVERNMENT GRANTS</td></tr>
                        <tr><td>Equitable share (national)</td><td class="kwm-bt-val">R158M</td><td class="kwm-bt-pct">11%</td></tr>
                        <tr><td>Other grants (MIG, housing, etc.)</td><td class="kwm-bt-val">R96M</td><td class="kwm-bt-pct">7%</td></tr>
                    </table>
                    <p style="font-size:11px;color:#555;margin:6px 0;line-height:1.4;"><strong>How electricity works:</strong> The municipality buys bulk electricity from Eskom at ~R470M and sells it to consumers at R466M. The &ldquo;profit&rdquo; margin is minimal &mdash; the municipality is essentially a pass-through distributor. The same applies to water (bulk purchase + treatment cost vs sales revenue). Property rates (R362M) and fines (R103M) are the true &ldquo;own revenue&rdquo; that council controls.</p>
                    <h4>Expenditure &mdash; R1,384M</h4>
                    <table class="kwm-budget-table">
                        <tr><td>Bulk purchases (Eskom electricity, water)</td><td class="kwm-bt-val">R470M</td><td class="kwm-bt-pct">33%</td><td class="kwm-bt-note">Pass-through &mdash; municipality is middleman</td></tr>
                        <tr><td>Employee costs (salaries)</td><td class="kwm-bt-val">R365M</td><td class="kwm-bt-pct">25%</td><td class="kwm-bt-note">808 posts, 154 vacancies</td></tr>
                        <tr><td>Other operating costs</td><td class="kwm-bt-val">R260M</td><td class="kwm-bt-pct">18%</td><td class="kwm-bt-note">Repairs, materials, outsourced services</td></tr>
                        <tr><td>Capital expenditure</td><td class="kwm-bt-val">R169M</td><td class="kwm-bt-pct">12%</td><td class="kwm-bt-note">Roads, water, sewerage, housing projects</td></tr>
                        <tr><td>Depreciation &amp; finance charges</td><td class="kwm-bt-val">R120M</td><td class="kwm-bt-pct">8%</td><td class="kwm-bt-note">Non-cash + debt servicing</td></tr>
                    </table>
                    <p style="margin-top:8px;font-size:12px;color:#333;"><strong>Surplus: ~R49M (3%)</strong></p>
                    <h4>What Council Controls</h4>
                    <p style="font-size:12px;color:#555;line-height:1.5;">Of the R1,433M, only <strong>R794M (55%)</strong> is discretionary &mdash; salaries (R365M) + operating costs (R260M) + capital projects (R169M). The other 45% is locked into bulk electricity/water purchases, depreciation, and debt that council cannot redirect.</p>
                    <h4>Salary Packages</h4>
                    <table class="kwm-budget-table">
                        <tr><td>Municipal Manager</td><td class="kwm-bt-val">R1.72M</td><td></td></tr>
                        <tr><td>Directors (6 &times; R1.41M)</td><td class="kwm-bt-val">R8.44M</td><td></td></tr>
                        <tr><td>Executive Mayor</td><td class="kwm-bt-val">R1.07M</td><td></td></tr>
                        <tr><td>Deputy Mayor + Speaker</td><td class="kwm-bt-val">R1.73M</td><td></td></tr>
                        <tr><td>Mayoral Committee Members</td><td class="kwm-bt-val">R3.25M</td><td></td></tr>
                        <tr><td>Council Whip</td><td class="kwm-bt-val">R474K</td><td></td></tr>
                        <tr><td>Ordinary Councillors</td><td class="kwm-bt-val">R4.44M</td><td></td></tr>
                        <tr><td><strong>Total political cost</strong></td><td class="kwm-bt-val"><strong>R11.75M</strong></td><td class="kwm-bt-pct">0.8%</td></tr>
                    </table>
                    <h4>Capital Budget by Directorate</h4>
                    <table class="kwm-budget-table">
                        <tr><td>Technical Services (roads, water, sewerage)</td><td class="kwm-bt-val">R122.6M</td><td class="kwm-bt-pct">72%</td></tr>
                        <tr><td>Community Services</td><td class="kwm-bt-val">R20.8M</td><td class="kwm-bt-pct">12%</td></tr>
                        <tr><td>Electrical Services</td><td class="kwm-bt-val">R16.5M</td><td class="kwm-bt-pct">10%</td></tr>
                        <tr><td>Housing Services</td><td class="kwm-bt-val">R8M</td><td class="kwm-bt-pct">5%</td></tr>
                        <tr><td>Admin/Corporate/Finance</td><td class="kwm-bt-val">R1.2M</td><td class="kwm-bt-pct">1%</td></tr>
                    </table>
                    <p class="kwm-sources-note">Infrastructure Services (72% of capital spend) is chaired by Cllr Arends (ANC, Ward 11). Water losses increased from 13.7% to 33.7% &mdash; the budget prioritises smart water meters (R40M borrowing) to address this.</p>
                </div>
            </div>
        </div>
        <?php
        return ob_get_clean();
    }

    public function ajax_get_ward_data() {
        check_ajax_referer('kwm_nonce', 'nonce');
        $ward = isset($_GET['ward']) ? sanitize_text_field($_GET['ward']) : 'all';
        $data = self::get_all_wards();

        if ($ward !== 'all' && isset($data[$ward])) {
            wp_send_json_success([$ward => $data[$ward]]);
        }

        wp_send_json_success($data);
    }

    /**
     * All 11 Knysna wards with boundary polygons, councillor info, and POIs.
     * Boundaries sourced from OpenStreetMap Nominatim.
     * Data stored in assets/wards-data.json.
     */
    public static function get_all_wards() {
        static $wards = null;
        if ($wards !== null) {
            return $wards;
        }

        $json_file = KWM_PLUGIN_DIR . 'assets/wards-data.json';
        if (file_exists($json_file)) {
            $wards = json_decode(file_get_contents($json_file), true);
            if ($wards) {
                return $wards;
            }
        }

        // Fallback: empty
        $wards = [];
        return $wards;
    }

    /**
     * Save ward data back to JSON file.
     */
    public static function save_all_wards($wards) {
        $json_file = KWM_PLUGIN_DIR . 'assets/wards-data.json';
        return file_put_contents($json_file, json_encode($wards, JSON_PRETTY_PRINT));
    }

    /**
     * Admin menu.
     */
    public function add_admin_menu() {
        add_menu_page(
            'Knysna Wards Map',
            'Wards Map',
            'manage_options',
            'knysna-wards-map',
            [$this, 'render_admin_page'],
            'dashicons-location-alt',
            30
        );

        $map_page = get_page_by_path(self::PAGE_SLUG);
        $map_url = $map_page ? get_permalink($map_page) : home_url('/knysna-wards-map/');

        add_submenu_page(
            'knysna-wards-map',
            'Ward Settings',
            'Settings',
            'manage_options',
            'knysna-wards-map',
            [$this, 'render_admin_page']
        );

        add_submenu_page(
            'knysna-wards-map',
            'View Map',
            'View Map ↗',
            'manage_options',
            'kwm-view-map',
            '__return_null'
        );
    }

    /**
     * Redirect the "View Map" submenu to the frontend map page.
     */
    public function redirect_view_map() {
        if (isset($_GET['page']) && $_GET['page'] === 'kwm-view-map') {
            $map_page = get_page_by_path(self::PAGE_SLUG);
            $url = $map_page ? get_permalink($map_page) : home_url('/knysna-wards-map/');
            wp_redirect($url);
            exit;
        }
    }

    /**
     * AJAX handler to save a single ward's editable fields.
     */
    public function ajax_save_ward() {
        check_ajax_referer('kwm_admin_nonce', 'nonce');

        if (!current_user_can('manage_options')) {
            wp_send_json_error('Unauthorized');
        }

        $ward_num   = sanitize_text_field($_POST['ward_num'] ?? '');
        $wards      = self::get_all_wards();

        if (!isset($wards[$ward_num])) {
            wp_send_json_error('Ward not found');
        }

        $wards[$ward_num]['councillor'] = sanitize_text_field($_POST['councillor'] ?? '');
        $wards[$ward_num]['party']      = sanitize_text_field($_POST['party'] ?? '');
        $wards[$ward_num]['phone']      = sanitize_text_field($_POST['phone'] ?? '');
        $wards[$ward_num]['email']      = sanitize_email($_POST['email'] ?? '');

        $areas_raw = sanitize_text_field($_POST['areas'] ?? '');
        if ($areas_raw) {
            $wards[$ward_num]['areas'] = array_map('trim', explode(',', $areas_raw));
        }

        self::save_all_wards($wards);
        wp_send_json_success('Saved');
    }

    /**
     * Admin page output.
     */
    public function render_admin_page() {
        $wards = self::get_all_wards();
        $map_page = get_page_by_path(self::PAGE_SLUG);
        $map_url = $map_page ? get_permalink($map_page) : home_url('/knysna-wards-map/');
        ?>
        <div class="wrap">
            <h1>Knysna Wards Map</h1>
            <p>
                <a href="<?php echo esc_url($map_url); ?>" target="_blank" class="button button-primary">View Map</a>
                <span class="description" style="margin-left:10px;">Shortcode: <code>[knysna_wards_map]</code></span>
            </p>

            <h2>Ward Councillors</h2>
            <table class="wp-list-table widefat fixed striped">
                <thead>
                    <tr>
                        <th style="width:60px;">Ward</th>
                        <th>Councillor</th>
                        <th>Party</th>
                        <th>Phone</th>
                        <th>Email</th>
                        <th>Areas</th>
                        <th style="width:80px;">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($wards as $num => $ward) : ?>
                    <tr data-ward="<?php echo esc_attr($num); ?>">
                        <td><strong><?php echo esc_html($num); ?></strong></td>
                        <td><input type="text" class="kwm-field" name="councillor" value="<?php echo esc_attr($ward['councillor'] ?? ''); ?>" style="width:100%;"></td>
                        <td><input type="text" class="kwm-field" name="party" value="<?php echo esc_attr($ward['party'] ?? ''); ?>" style="width:100%;"></td>
                        <td><input type="text" class="kwm-field" name="phone" value="<?php echo esc_attr($ward['phone'] ?? ''); ?>" style="width:100%;"></td>
                        <td><input type="email" class="kwm-field" name="email" value="<?php echo esc_attr($ward['email'] ?? ''); ?>" style="width:100%;"></td>
                        <td><input type="text" class="kwm-field" name="areas" value="<?php echo esc_attr(implode(', ', $ward['areas'] ?? [])); ?>" style="width:100%;"></td>
                        <td><button class="button kwm-save-btn">Save</button></td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>

            <h2 style="margin-top:20px;">Map Info</h2>
            <table class="form-table">
                <tr>
                    <th>Total Wards</th>
                    <td><?php echo count($wards); ?></td>
                </tr>
                <tr>
                    <th>Data Source</th>
                    <td>OpenStreetMap Nominatim (ward boundaries)</td>
                </tr>
                <tr>
                    <th>Data File</th>
                    <td><code>assets/wards-data.json</code> (<?php echo round(filesize(KWM_PLUGIN_DIR . 'assets/wards-data.json') / 1024); ?> KB)</td>
                </tr>
            </table>
        </div>

        <script>
        jQuery(function($){
            $('.kwm-save-btn').on('click', function(){
                var $row = $(this).closest('tr');
                var btn = $(this);
                btn.prop('disabled', true).text('Saving...');

                $.post(ajaxurl, {
                    action: 'kwm_save_ward',
                    nonce: '<?php echo wp_create_nonce('kwm_admin_nonce'); ?>',
                    ward_num: $row.data('ward'),
                    councillor: $row.find('[name=councillor]').val(),
                    party: $row.find('[name=party]').val(),
                    phone: $row.find('[name=phone]').val(),
                    email: $row.find('[name=email]').val(),
                    areas: $row.find('[name=areas]').val(),
                }, function(resp){
                    btn.prop('disabled', false).text('Save');
                    if(resp.success){
                        btn.text('Saved!');
                        setTimeout(function(){ btn.text('Save'); }, 1500);
                    } else {
                        alert('Error: ' + (resp.data || 'Unknown'));
                    }
                });
            });
        });
        </script>
        <?php
    }
}

new Knysna_Wards_Map();
