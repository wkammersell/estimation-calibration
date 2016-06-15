
Ext.define('CustomApp', {
    extend: 'Rally.app.TimeboxScopedApp',
    scopeType: 'release',
	filters: [],
    pagesize: 2000,
    estimate_times: {},
    
    launch: function() {
		this.fetchWorkItems( this.getContext().getTimeboxScope() );
    },
    
    onTimeboxScopeChange: function(newTimeboxScope) {
		this.callParent( arguments );
		this.fetchWorkItems( newTimeboxScope );
	},
    
    fetchWorkItems:function( timeboxScope ){
        this.removeAll();
        this.filters = [];
        this.estimate_times = {};
        
        // Look for iterations that are within the release
        this.filters = [];
        var startDate = timeboxScope.record.raw.ReleaseStartDate;
        var endDate = timeboxScope.record.raw.ReleaseDate;
        var startDateFilter = Ext.create('Rally.data.wsapi.Filter', {
             property : 'InProgressDate',
             operator: '>=',
             value: startDate
        });
        
        var endDateFilter = Ext.create('Rally.data.wsapi.Filter', {
             property : 'AcceptedDate',
             operator: '<=',
             value: endDate
        });
        
        var estimateFilter = Ext.create('Rally.data.wsapi.Filter', {
             property : 'PlanEstimate',
             operator: '!=',
             value: 'null'
        });
        
        this.filters.push( startDateFilter );
        this.filters.push( endDateFilter );
        this.filters.push( estimateFilter );

		var dataScope = this.getContext().getDataContext();
		var store = Ext.create(
			'Rally.data.wsapi.Store',
			{
				model: 'UserStory',
				fetch: ['InProgressDate','AcceptedDate','PlanEstimate'],
				context: dataScope,
				pageSize: this.pagesize,
				limit:this.pagesize,
				sorters:[{
					property:'PlanEstimate',
					direction: 'ASC'
				}]
			},
			this
        );

        store.addFilter(this.filters,false);
        store.loadPage(1, {
            scope: this,
            callback: function( records, operation ) {
                if( operation.wasSuccessful() ) {
                    _.each( records, function( record ) {
						if ( record.data.InProgressDate !== null && record.data.AcceptedDate !== null ) {
							var estimate = record.data.PlanEstimate;
							// convert cycle time from milliseconds to days
							var cycle_time = ( record.data.AcceptedDate - record.data.InProgressDate ) / ( 1000 * 60 * 60 * 24 );

							if ( !( _.contains( Object.keys( this.estimate_times ), estimate.toString() ) ) ) {
								this.estimate_times[ estimate ] = [];
							}
							this.estimate_times[ estimate ].push( cycle_time );
                        }
                    }, this );
                    this.prepareChart();
                }
            }
        });
    },
  
    prepareChart:function(){
         if (Object.keys( this.estimate_times ).length > 0) {
            var categories = Object.keys( this.estimate_times );
            var series = [];
            
			_.each( this.estimate_times, function( values ) {
				values = values.sort(function(a, b){return a-b; } );

				// logic from http://thiruvikramangovindarajan.blogspot.com/2014/10/calculate-quartile-q1-q3-and-median-q2.html
				var Q1 = 0;
				var Q2 = 0;
				var Q3 = 0;
				var q1Arr = [];
				var q2Arr = [];
				var q3Arr = [];
				
				if ( values.length == 1 ) {
					q1Arr = q2Arr = q3Arr = values;
				} else {
					q1Arr = (values.length % 2 === 0) ? values.slice(0, (values.length / 2)) : values.slice(0, Math.floor(values.length / 2));
					q2Arr =  values;
					q3Arr = (values.length % 2 === 0) ? values.slice((values.length / 2), values.length) : values.slice(Math.ceil(values.length / 2), values.length);
				}
				
				Q1 = this.medianX(q1Arr);
				Q2 = this.medianX(q2Arr);
				Q3 = this.medianX(q3Arr);
				series.push( [ values[0], Q1, Q2, Q3, values[ values.length - 1] ] );
            }, this );

            this.makeChart( series, categories );
        }
        else{
            this.showNoDataBox();
        }    
    },
    
    makeChart:function(series_data, categories_data){
        // see http://www.highcharts.com/demo/box-plot for good examples
        var chart = this.add({
            xtype: 'rallychart',
            chartConfig: {
                chart:{
                    type: 'boxplot'
                },
                title:{
                    text: 'Cycle Time by Plan Estimate'
                },
                xAxis: {
                    title: {
                        text: 'Plan Estimate (Points)'
                    }
                },
                yAxis:{
                    title: {
                        text: 'Cycle Time (Days)'
                    },
                    allowDecimals: false,
                    min : 0
                },
                plotOptions: {
                    column: {
                        pointPadding: 0.2,
                        borderWidth: 0
                    }
                }
            },
                            
            chartData: {
                series: [ {
					name: 'Cycle Time (Days)',
					data: series_data
                } ],
                categories: categories_data
            }
          
        });
    },
    
    showNoDataBox:function(){
        Ext.ComponentQuery.query('container[itemId=stats]')[0].update('There is no data. </br>Check if there are interations in scope and work items with PlanEstimate assigned for iterations');
    },
    
    medianX:function(medianArr) {
		count = medianArr.length;
		median = (count % 2 === 0) ? (medianArr[(medianArr.length/2) - 1] + medianArr[(medianArr.length / 2)]) / 2:medianArr[Math.floor(medianArr.length / 2)];
		return median;
	}
});